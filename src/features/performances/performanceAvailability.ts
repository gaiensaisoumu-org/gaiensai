import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

export type PerformanceAvailabilityData = {
  config?: { junior_release_open?: boolean | null };
  class_performances?: unknown[];
  schedules?: unknown[];
  class_counters?: unknown[];
  gym_performances?: unknown[];
  gym_counters?: unknown[];
};

export type AvailabilityResponse = {
  data: PerformanceAvailabilityData | null;
  error: Error | null;
  usedCloudflareFallback?: boolean;
};

export type AvailabilitySource = 'public' | 'monitor';

let publicInFlightRequest: Promise<AvailabilityResponse> | null = null;
let publicCachedResponse: {
  value: AvailabilityResponse;
  expiresAt: number;
} | null = null;

// Cloudflare already has a 3-second shared cache. This small browser cache
// prevents duplicate requests from components mounted in the same render.
const PUBLIC_CACHE_TTL_MS = 3_000;
const PUBLIC_REFRESH_MS = 5_000;
const MONITOR_RESYNC_MS = 60_000;
const MONITOR_DIRECT_TIMEOUT_MS = 8_000;
const publicRefreshSubscribers = new Set<() => void>();
let publicRefreshTimer: number | null = null;
const monitorRefreshSubscribers = new Set<() => void>();
let monitorRefreshChannel: RealtimeChannel | null = null;
let monitorRefreshTimer: number | null = null;

const getPublicAvailabilityUrl = () =>
  import.meta.env.VITE_PERFORMANCE_AVAILABILITY_API_URL ||
  (import.meta.env.DEV
    ? '/performances-availability'
    : 'https://api.gaiensai.com/performances-availability');

const fetchPublicAvailability = async (): Promise<AvailabilityResponse> => {
  const response = await fetch(getPublicAvailabilityUrl(), {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Availability API returned ${response.status}`);
  }

  return {
    data: (await response.json()) as PerformanceAvailabilityData,
    error: null,
  };
};

const withMonitorTimeout = async <T>(promise: PromiseLike<T>): Promise<T> => {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new Error('Supabase availability request timed out')),
      MONITOR_DIRECT_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
};

export const getPerformanceAvailability = async (
  source: AvailabilitySource = 'public',
): Promise<AvailabilityResponse> => {
  // The monitor deliberately bypasses Cloudflare. Its initial and recovery
  // fetches use the existing Supabase RPC directly. If that path is down,
  // show Cloudflare's most recent snapshot while retaining an error signal.
  if (source === 'monitor') {
    try {
      const result = await withMonitorTimeout(
        supabase.rpc('get_performance_availability'),
      );
      if (!result.error) {
        return {
          data: (result.data as PerformanceAvailabilityData | null) ?? null,
          error: null,
        };
      }

      const fallback = await fetchPublicAvailability();
      return {
        ...fallback,
        error: result.error,
        usedCloudflareFallback: true,
      };
    } catch (error) {
      const fallback = await fetchPublicAvailability();
      return {
        ...fallback,
        error: error instanceof Error ? error : new Error('Supabase availability request failed'),
        usedCloudflareFallback: true,
      };
    }
  }

  if (publicCachedResponse && publicCachedResponse.expiresAt > Date.now()) {
    return publicCachedResponse.value;
  }

  if (!publicInFlightRequest) {
    publicInFlightRequest = fetchPublicAvailability();
    void publicInFlightRequest.finally(() => {
      publicInFlightRequest = null;
    });
  }

  const response = await publicInFlightRequest;
  publicCachedResponse = {
    value: response,
    expiresAt: Date.now() + PUBLIC_CACHE_TTL_MS,
  };
  return response;
};

/**
 * All public availability consumers share one five-second timer. Components
 * still keep their own displayed state, while duplicate page widgets coalesce
 * into the same in-flight Cloudflare request.
 */
export const subscribePublicPerformanceAvailability = (
  onRefreshNeeded: () => void,
): (() => void) => {
  publicRefreshSubscribers.add(onRefreshNeeded);
  if (publicRefreshTimer === null) {
    publicRefreshTimer = window.setInterval(() => {
      publicRefreshSubscribers.forEach((subscriber) => subscriber());
    }, PUBLIC_REFRESH_MS);
  }

  return () => {
    publicRefreshSubscribers.delete(onRefreshNeeded);
    if (publicRefreshSubscribers.size === 0 && publicRefreshTimer !== null) {
      window.clearInterval(publicRefreshTimer);
      publicRefreshTimer = null;
    }
  };
};

/**
 * Direct Realtime subscription for the small number of long-running monitor
 * displays. A successful (re)subscription and a 60-second safety timer both
 * request a complete snapshot, so missed events cannot leave the screen stale.
 */
export const subscribeMonitorPerformanceAvailability = (
  onSyncNeeded: () => void,
): (() => void) => {
  monitorRefreshSubscribers.add(onSyncNeeded);
  if (!monitorRefreshChannel) {
    const notifySubscribers = () => {
      monitorRefreshSubscribers.forEach((subscriber) => subscriber());
    };
    monitorRefreshChannel = supabase
      .channel('monitor-performance-availability')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'class_ticket_counters' },
        notifySubscribers,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'gym_ticket_counters' },
        notifySubscribers,
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          notifySubscribers();
        }
      });
    monitorRefreshTimer = window.setInterval(
      notifySubscribers,
      MONITOR_RESYNC_MS,
    );
  }

  return () => {
    monitorRefreshSubscribers.delete(onSyncNeeded);
    if (monitorRefreshSubscribers.size === 0 && monitorRefreshChannel) {
      void supabase.removeChannel(monitorRefreshChannel);
      monitorRefreshChannel = null;
      if (monitorRefreshTimer !== null) {
        window.clearInterval(monitorRefreshTimer);
        monitorRefreshTimer = null;
      }
    }
  };
};
