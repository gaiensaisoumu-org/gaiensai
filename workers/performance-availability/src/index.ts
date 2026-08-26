/**
 * Public performance availability edge API.
 *
 * The Durable Object is the only Supabase Realtime subscriber in this Worker.
 * It always fetches a complete RPC snapshot before (re)subscribing, which makes
 * reconnects safe even when Postgres changes while the socket is disconnected.
 */
export interface Env {
  PERFORMANCE_AVAILABILITY: DurableObjectNamespace;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

type AvailabilitySnapshot = Record<string, unknown>;
type PhoenixMessage = {
  event?: string;
  topic?: string;
  payload?: unknown;
  ref?: string;
};

const CACHE_TTL_SECONDS = 3;
const RECONNECT_DELAY_MS = 5_000;
const HEALTH_CHECK_SECONDS = 30;
const HEARTBEAT_MS = 25_000;
const REALTIME_TABLES = [
  'class_ticket_counters',
  'gym_ticket_counters',
  'class_performances',
  'performances_schedule',
  'gym_performances',
  'configs',
] as const;

const jsonResponse = (body: AvailabilitySnapshot, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // This endpoint contains only public, shared availability data.
      'cache-control': `public, max-age=0, s-maxage=${CACHE_TTL_SECONDS}`,
      'access-control-allow-origin': '*',
      ...(init?.headers ?? {}),
    },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, OPTIONS',
        },
      });
    }
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/performances-availability') {
      return new Response('Not Found', { status: 404 });
    }

    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }

    const id = env.PERFORMANCE_AVAILABILITY.idFromName('global');
    const response = await env.PERFORMANCE_AVAILABILITY.get(id).fetch(
      'https://availability.internal/snapshot',
    );
    if (!response.ok) {
      return response;
    }

    const publicResponse = new Response(response.body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=0, s-maxage=${CACHE_TTL_SECONDS}`,
        'access-control-allow-origin': '*',
      },
    });
    await cache.put(request, publicResponse.clone());
    return publicResponse;
  },
};

export class PerformanceAvailabilityDurableObject {
  private snapshot: AvailabilitySnapshot | null = null;
  private socket: WebSocket | null = null;
  private syncPromise: Promise<void> | null = null;
  private messageRef = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    this.state.blockConcurrencyWhile(async () => {
      this.snapshot = (await this.state.storage.get<AvailabilitySnapshot>(
        'snapshot',
      )) ?? null;
      await this.state.storage.setAlarm(Date.now() + HEALTH_CHECK_SECONDS * 1_000);
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== '/snapshot') {
      return new Response('Not Found', { status: 404 });
    }

    try {
      await this.ensureReady();
    } catch {
      // Do not expose Supabase error details and do not make callers fall back
      // to Supabase. A stored snapshot remains useful during a transient outage.
      if (!this.snapshot) {
        return new Response('Availability temporarily unavailable', { status: 503 });
      }
    }

    return jsonResponse({
      ...this.snapshot,
      updatedAt: await this.state.storage.get<string>('updatedAt'),
      lastRealtimeEventAt: await this.state.storage.get<string>(
        'lastRealtimeEventAt',
      ),
    });
  }

  async alarm(): Promise<void> {
    // An evicted DO has no in-memory WebSocket. This lightweight health check
    // restores the connection; ensureReady performs the required full sync.
    try {
      await this.ensureReady();
    } finally {
      await this.state.storage.setAlarm(Date.now() + HEALTH_CHECK_SECONDS * 1_000);
    }
  }

  private async ensureReady(): Promise<void> {
    if (!this.snapshot || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      await this.syncAndConnect();
    }
  }

  private async syncAndConnect(): Promise<void> {
    if (!this.syncPromise) {
      this.syncPromise = (async () => {
        await this.syncSnapshot();
        this.connectRealtime();
      })().finally(() => {
        this.syncPromise = null;
      });
    }
    await this.syncPromise;
  }

  private async syncSnapshot(): Promise<void> {
    const response = await fetch(
      `${this.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/get_performance_availability`,
      {
        method: 'POST',
        headers: {
          apikey: this.env.SUPABASE_ANON_KEY,
          authorization: `Bearer ${this.env.SUPABASE_ANON_KEY}`,
          'content-type': 'application/json',
        },
        body: '{}',
      },
    );
    if (!response.ok) {
      throw new Error(`Supabase availability RPC: ${response.status}`);
    }

    this.snapshot = (await response.json()) as AvailabilitySnapshot;
    const updatedAt = new Date().toISOString();
    await this.state.storage.put({ snapshot: this.snapshot, updatedAt });
  }

  private connectRealtime(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    const realtimeUrl = new URL(
      `${this.env.SUPABASE_URL.replace(/^http/, 'ws').replace(/\/$/, '')}/realtime/v1/websocket`,
    );
    realtimeUrl.searchParams.set('apikey', this.env.SUPABASE_ANON_KEY);
    realtimeUrl.searchParams.set('vsn', '1.0.0');
    const socket = new WebSocket(realtimeUrl.toString());
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.sendPhoenix(socket, 'realtime:performance-availability', 'phx_join', {
        config: {
          broadcast: { self: false },
          presence: { key: '' },
          postgres_changes: REALTIME_TABLES.map((table) => ({
            event: '*',
            schema: 'public',
            table,
          })),
        },
        access_token: this.env.SUPABASE_ANON_KEY,
      });
      this.startHeartbeat(socket);
    });
    socket.addEventListener('message', (event) => {
      let message: PhoenixMessage;
      try {
        message = JSON.parse(String(event.data)) as PhoenixMessage;
      } catch {
        return;
      }
      if (message.event !== 'postgres_changes') {
        if (
          message.event === 'phx_reply' &&
          (message.payload as { status?: string } | undefined)?.status === 'error'
        ) {
          socket.close();
        }
        return;
      }
      void this.state.blockConcurrencyWhile(async () => {
        await this.state.storage.put('lastRealtimeEventAt', new Date().toISOString());
        // Reuse the established RPC shape rather than duplicating capacity math
        // or accidentally publishing non-public database fields.
        await this.syncSnapshot();
      });
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) {
        return;
      }
      this.stopHeartbeat();
      this.socket = null;
      void this.state.storage.setAlarm(Date.now() + RECONNECT_DELAY_MS);
    });
    socket.addEventListener('error', () => socket.close());
  }

  private sendPhoenix(
    socket: WebSocket,
    topic: string,
    event: string,
    payload: Record<string, unknown>,
  ): void {
    this.messageRef += 1;
    socket.send(
      JSON.stringify({ topic, event, payload, ref: String(this.messageRef) }),
    );
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
        this.stopHeartbeat();
        return;
      }
      this.sendPhoenix(socket, 'phoenix', 'heartbeat', {});
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
