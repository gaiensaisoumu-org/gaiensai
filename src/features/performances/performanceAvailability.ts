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
const publicRefreshSubscribers = new Set<() => void>();
let publicRefreshTimer: number | null = null;

const getPublicAvailabilityUrl = () =>
  import.meta.env.VITE_PERFORMANCE_AVAILABILITY_API_URL ||
  '/api/performance-availability';

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

export const getPerformanceAvailability = async (
  source: AvailabilitySource = 'public',
): Promise<AvailabilityResponse> => {
  // The monitor deliberately bypasses Cloudflare. Its initial and recovery
  // fetches use the existing Supabase RPC directly.
  if (source === 'monitor') {
    const result = await supabase.rpc('get_performance_availability');
    return {
      data: (result.data as PerformanceAvailabilityData | null) ?? null,
      error: result.error,
    };
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
  const channel: RealtimeChannel = supabase
    .channel('monitor-performance-availability')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'class_ticket_counters' },
      onSyncNeeded,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'gym_ticket_counters' },
      onSyncNeeded,
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        onSyncNeeded();
      }
    });

  const timer = window.setInterval(onSyncNeeded, MONITOR_RESYNC_MS);
  return () => {
    window.clearInterval(timer);
    void supabase.removeChannel(channel);
  };
};
