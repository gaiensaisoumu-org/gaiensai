/**
 * Public performance availability edge API.
 *
 * The Durable Object is the only Supabase Realtime subscriber in this Worker.
 * It always fetches a complete RPC snapshot before (re)subscribing, which makes
 * reconnects safe even when Postgres changes while the socket is disconnected.
 */
export interface Env {
  PERFORMANCE_AVAILABILITY: DurableObjectNamespace;
  APP_DATA_CACHE: DurableObjectNamespace;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
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
const FALLBACK_RESYNC_MS = 60_000;
const REALTIME_TABLES = [
  'class_ticket_counters',
  'gym_ticket_counters',
  'class_performances',
  'performances_schedule',
  'gym_performances',
  'configs',
] as const;
const APP_DATA_REALTIME_TABLES = [
  'configs',
  'flappy_leaderboard',
  'rehearsal_round_names',
  'rehearsals',
  'ticket_issue_controls',
  'tickets',
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

const getCacheKey = (request: Request, bucket: number): Request => {
  const url = new URL(request.url);
  // Cache API entries do not reliably expire from response Cache-Control alone.
  // A bucketed key guarantees that a new shared entry is used every three
  // seconds, while keeping cache-only details out of the public request URL.
  url.search = '';
  url.searchParams.set('__availability_cache_bucket', String(bucket));
  return new Request(url.toString());
};

const getUserCounterCacheKey = async (request: Request, bucket: number) => {
  const token = request.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  const tokenHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const url = new URL(request.url);
  url.search = '';
  url.searchParams.set('__user_counter_cache_bucket', String(bucket));
  url.searchParams.set('__token', tokenHash);
  return new Request(url.toString());
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-allow-headers': 'authorization, content-type',
        },
      });
    }
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    if (
      url.pathname === '/app-data-cache/student-dashboard' ||
      url.pathname === '/app-data-cache/junior-dashboard' ||
      url.pathname === '/app-data-cache/student-issue-bootstrap'
    ) {
      const cacheBucket = Math.floor(Date.now() / (CACHE_TTL_SECONDS * 1_000));
      const cacheKey = await getUserCounterCacheKey(request, cacheBucket);
      if (!cacheKey) {
        return new Response('Unauthorized', { status: 401 });
      }
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) {
        return cached;
      }
      const authorization = request.headers.get('authorization')!;
      const rpc = async (name: string) =>
        fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
          method: 'POST',
          headers: {
            apikey: env.SUPABASE_PUBLISHABLE_KEY,
            authorization,
            'content-type': 'application/json',
          },
          body: '{}',
        });
      const responses =
        url.pathname === '/app-data-cache/student-dashboard'
          ? await Promise.all([
              rpc('get_student_dashboard'),
              rpc('get_student_performance_ticket_remaining'),
              fetch(
                `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/student_rehearsal_issue_counters?select=rehearsal_type,issued_count`,
                {
                  headers: {
                    apikey: env.SUPABASE_PUBLISHABLE_KEY,
                    authorization,
                  },
                },
              ),
            ])
          : url.pathname === '/app-data-cache/student-issue-bootstrap'
            ? [await rpc('get_student_issue_bootstrap')]
            : [await rpc('get_junior_my_page')];
      if (responses.some((response) => !response.ok)) {
        return new Response('Unable to load dashboard', { status: 502 });
      }
      const body =
        url.pathname === '/app-data-cache/student-dashboard'
          ? JSON.stringify({
              dashboard: await responses[0].json(),
              remaining: await responses[1].json(),
              rehearsalCounters: await responses[2].json(),
            })
          : url.pathname === '/app-data-cache/student-issue-bootstrap'
            ? JSON.stringify({ data: await responses[0].json() })
            : JSON.stringify({ dashboard: await responses[0].json() });
      const privateResponse = new Response(body, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': `private, max-age=0, s-maxage=${CACHE_TTL_SECONDS}`,
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization, content-type',
        },
      });
      await cache.put(cacheKey, privateResponse.clone());
      await cache.delete(
        (await getUserCounterCacheKey(request, cacheBucket - 1)) as Request,
      );
      return privateResponse;
    }
    if (url.pathname === '/app-data-cache/ticket') {
      const code = url.searchParams.get('code')?.trim();
      if (!code || code.length > 256) {
        return new Response('Invalid ticket code', { status: 400 });
      }
      const cache = caches.default;
      const cacheBucket = Math.floor(Date.now() / (CACHE_TTL_SECONDS * 1_000));
      const cacheKey = getCacheKey(request, cacheBucket);
      const cached = await cache.match(cacheKey);
      if (cached) {
        return cached;
      }
      const id = env.APP_DATA_CACHE.idFromName('app-data-v1');
      const response = await env.APP_DATA_CACHE.get(id).fetch(
        `https://app-data.internal/ticket?code=${encodeURIComponent(code)}`,
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
      await cache.put(cacheKey, publicResponse.clone());
      await cache.delete(getCacheKey(request, cacheBucket - 1));
      return publicResponse;
    }
    if (url.pathname === '/app-data-cache/user-counters') {
      const cacheBucket = Math.floor(Date.now() / (CACHE_TTL_SECONDS * 1_000));
      const cacheKey = await getUserCounterCacheKey(request, cacheBucket);
      if (!cacheKey) return new Response('Unauthorized', { status: 401 });
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      const authorization = request.headers.get('authorization')!;
      const response = await fetch(
        `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/student_ticket_issue_counters?select=performance_type,performance_id,issued_count`,
        { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization } },
      );
      if (!response.ok)
        return new Response('Unable to load ticket counters', {
          status: response.status,
        });
      const body = JSON.stringify({
        student_ticket_issue_counters: await response.json(),
      });
      const publicResponse = new Response(body, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': `private, max-age=0, s-maxage=${CACHE_TTL_SECONDS}`,
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization, content-type',
        },
      });
      await cache.put(cacheKey, publicResponse.clone());
      await cache.delete(
        (await getUserCounterCacheKey(request, cacheBucket - 1)) as Request,
      );
      return publicResponse;
    }
    if (
      url.pathname !== '/performances-availability' &&
      url.pathname !== '/app-data-cache'
    ) {
      return new Response('Not Found', { status: 404 });
    }

    const cache = caches.default;
    const cacheBucket = Math.floor(Date.now() / (CACHE_TTL_SECONDS * 1_000));
    const cacheKey = getCacheKey(request, cacheBucket);
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }

    // Bump this cache-only object name when a deployment must discard a
    // long-lived pre-change snapshot and perform the mandatory initial sync.
    const isAppData = url.pathname === '/app-data-cache';
    const namespace = isAppData
      ? env.APP_DATA_CACHE
      : env.PERFORMANCE_AVAILABILITY;
    const id = namespace.idFromName(
      isAppData ? 'app-data-v1' : 'availability-v2',
    );
    const response = await namespace
      .get(id)
      .fetch(
        isAppData
          ? 'https://app-data.internal/snapshot'
          : 'https://availability.internal/snapshot',
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
    await cache.put(cacheKey, publicResponse.clone());
    // Prevent an ever-growing set of bucket keys in each edge cache.
    await cache.delete(getCacheKey(request, cacheBucket - 1));
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
      this.snapshot =
        (await this.state.storage.get<AvailabilitySnapshot>('snapshot')) ??
        null;
      await this.state.storage.setAlarm(
        Date.now() + HEALTH_CHECK_SECONDS * 1_000,
      );
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== '/snapshot') {
      return new Response('Not Found', { status: 404 });
    }

    try {
      await this.ensureReady();
    } catch (error) {
      // Do not expose Supabase error details and do not make callers fall back
      // to Supabase. A stored snapshot remains useful during a transient outage.
      console.error('Availability snapshot synchronization failed', error);
      if (!this.snapshot) {
        return new Response('Availability temporarily unavailable', {
          status: 503,
        });
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
      await this.state.storage.setAlarm(
        Date.now() + HEALTH_CHECK_SECONDS * 1_000,
      );
    }
  }

  private async ensureReady(): Promise<void> {
    const lastSyncedAt = await this.state.storage.get<number>('lastSyncedAt');
    const needsFallbackSync =
      !lastSyncedAt || Date.now() - lastSyncedAt >= FALLBACK_RESYNC_MS;
    if (
      !this.snapshot ||
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN ||
      needsFallbackSync
    ) {
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
          apikey: this.env.SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${this.env.SUPABASE_PUBLISHABLE_KEY}`,
          'content-type': 'application/json',
        },
        body: '{}',
      },
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1_000);
      throw new Error(
        `Supabase availability RPC: ${response.status}${detail ? ` ${detail}` : ''}`,
      );
    }

    this.snapshot = (await response.json()) as AvailabilitySnapshot;
    const updatedAt = new Date().toISOString();
    await this.state.storage.put({
      snapshot: this.snapshot,
      updatedAt,
      lastSyncedAt: Date.now(),
    });
  }

  private connectRealtime(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    const realtimeUrl = new URL(
      `${this.env.SUPABASE_URL.replace(/^http/, 'ws').replace(/\/$/, '')}/realtime/v1/websocket`,
    );
    realtimeUrl.searchParams.set('apikey', this.env.SUPABASE_PUBLISHABLE_KEY);
    realtimeUrl.searchParams.set('vsn', '1.0.0');
    const socket = new WebSocket(realtimeUrl.toString());
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.sendPhoenix(
        socket,
        'realtime:performance-availability',
        'phx_join',
        {
          config: {
            broadcast: { self: false },
            presence: { key: '' },
            postgres_changes: REALTIME_TABLES.map((table) => ({
              event: '*',
              schema: 'public',
              table,
            })),
          },
          access_token: this.env.SUPABASE_PUBLISHABLE_KEY,
        },
      );
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
          (message.payload as { status?: string } | undefined)?.status ===
            'error'
        ) {
          socket.close();
        }
        return;
      }
      void this.state.blockConcurrencyWhile(async () => {
        await this.state.storage.put(
          'lastRealtimeEventAt',
          new Date().toISOString(),
        );
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

/**
 * Shared site data has a separate DO so that one Supabase Realtime subscription
 * refreshes every Cloudflare edge cache without exposing user-scoped rows.
 */
export class AppDataCacheDurableObject {
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
      this.snapshot =
        (await this.state.storage.get<AvailabilitySnapshot>('snapshot')) ??
        null;
      await this.state.storage.setAlarm(
        Date.now() + HEALTH_CHECK_SECONDS * 1_000,
      );
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ticket') {
      const code = url.searchParams.get('code');
      if (!code) {
        return new Response('Invalid ticket code', { status: 400 });
      }
      try {
        await this.ensureReady();
      } catch (error) {
        console.error('App data snapshot synchronization failed', error);
        if (!this.snapshot) {
          return new Response('App data temporarily unavailable', {
            status: 503,
          });
        }
      }
      const tickets =
        (this.snapshot?.tickets as
          Array<Record<string, unknown>> | undefined) ?? [];
      const ticket = tickets.find((item) => item.code === code) ?? null;
      return jsonResponse({ ticket });
    }
    if (url.pathname !== '/snapshot')
      return new Response('Not Found', { status: 404 });
    try {
      await this.ensureReady();
    } catch (error) {
      console.error('App data snapshot synchronization failed', error);
      if (!this.snapshot)
        return new Response('App data temporarily unavailable', {
          status: 503,
        });
    }
    const { tickets: _tickets, ...publicSnapshot } = this.snapshot ?? {};
    return jsonResponse({
      ...publicSnapshot,
      updatedAt: await this.state.storage.get<string>('updatedAt'),
    });
  }

  async alarm(): Promise<void> {
    try {
      await this.ensureReady();
    } finally {
      await this.state.storage.setAlarm(
        Date.now() + HEALTH_CHECK_SECONDS * 1_000,
      );
    }
  }

  private async ensureReady(): Promise<void> {
    const lastSyncedAt = await this.state.storage.get<number>('lastSyncedAt');
    if (
      !this.snapshot ||
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN ||
      !lastSyncedAt ||
      Date.now() - lastSyncedAt >= FALLBACK_RESYNC_MS
    ) {
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
      `${this.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/get_cloudflare_app_data_snapshot`,
      {
        method: 'POST',
        headers: {
          apikey: this.env.SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${this.env.SUPABASE_PUBLISHABLE_KEY}`,
          'content-type': 'application/json',
        },
        body: '{}',
      },
    );
    if (!response.ok)
      throw new Error(`Supabase app data RPC: ${response.status}`);
    this.snapshot = (await response.json()) as AvailabilitySnapshot;
    await this.state.storage.put({
      snapshot: this.snapshot,
      updatedAt: new Date().toISOString(),
      lastSyncedAt: Date.now(),
    });
  }

  private connectRealtime(): void {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    const realtimeUrl = new URL(
      `${this.env.SUPABASE_URL.replace(/^http/, 'ws').replace(/\/$/, '')}/realtime/v1/websocket`,
    );
    realtimeUrl.searchParams.set('apikey', this.env.SUPABASE_PUBLISHABLE_KEY);
    realtimeUrl.searchParams.set('vsn', '1.0.0');
    const socket = new WebSocket(realtimeUrl.toString());
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.sendPhoenix(socket, 'realtime:app-data-cache', 'phx_join', {
        config: {
          broadcast: { self: false },
          presence: { key: '' },
          postgres_changes: APP_DATA_REALTIME_TABLES.map((table) => ({
            event: '*',
            schema: 'public',
            table,
          })),
        },
        access_token: this.env.SUPABASE_PUBLISHABLE_KEY,
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
      if (message.event === 'postgres_changes')
        void this.state.blockConcurrencyWhile(() => this.syncSnapshot());
      else if (
        message.event === 'phx_reply' &&
        (message.payload as { status?: string } | undefined)?.status === 'error'
      )
        socket.close();
    });
    socket.addEventListener('close', () => {
      if (this.socket === socket) {
        this.stopHeartbeat();
        this.socket = null;
        void this.state.storage.setAlarm(Date.now() + RECONNECT_DELAY_MS);
      }
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
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN)
        return this.stopHeartbeat();
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
