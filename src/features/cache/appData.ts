export type CachedAppData = {
  configs: Array<Record<string, unknown>>;
  flappy_leaderboard: Array<Record<string, unknown>>;
  rehearsal_round_names: Array<Record<string, unknown>>;
  rehearsals: Array<Record<string, unknown>>;
  ticket_issue_controls: Array<Record<string, unknown>>;
  performance_acceptance: Array<{
    performance_type: 'class' | 'gym' | 'club';
    performance_id: number;
    is_accepting: boolean | null;
    like_count: number;
  }>;
  admission_only_junior_account_count: number;
  updatedAt?: string;
};

export type CachedTicketStatus = {
  code: string;
  ticket_name: string | null;
  status: string;
};

let inFlight: Promise<CachedAppData> | null = null;
let cached: { value: CachedAppData; expiresAt: number } | null = null;
const CACHE_TTL_MS = 3_000;

const getAppDataUrl = () =>
  import.meta.env.VITE_APP_DATA_CACHE_API_URL ||
  (import.meta.env.DEV
    ? '/app-data-cache'
    : 'https://api.gaiensai.com/app-data-cache');

/** Shared data is fetched as one Cloudflare-cached snapshot per page. */
export const getCachedAppData = async (): Promise<CachedAppData> => {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  if (!inFlight) {
    inFlight = fetch(getAppDataUrl(), {
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`App data API returned ${response.status}`);
        }
        return (await response.json()) as CachedAppData;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  const value = await inFlight;
  cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
};

export const getCachedTicketStatus = async (
  code: string,
): Promise<CachedTicketStatus | null> => {
  const url = new URL(`${getAppDataUrl()}/ticket`, window.location.origin);
  url.searchParams.set('code', code);
  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Ticket cache API returned ${response.status}`);
  }
  return ((await response.json()) as { ticket: CachedTicketStatus | null })
    .ticket;
};

const privateRequests = new Map<string, Promise<unknown>>();

const getPrivateCachedData = async <T>(path: string): Promise<T> => {
  const existing = privateRequests.get(path);
  if (existing) {
    return existing as Promise<T>;
  }
  const request = (async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('Not authenticated');
    }
    const response = await fetch(
      new URL(`${getAppDataUrl()}/${path}`, window.location.origin).toString(),
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Private app data API returned ${response.status}`);
    }
    return (await response.json()) as T;
  })().finally(() => {
    privateRequests.delete(path);
  });
  privateRequests.set(path, request);
  return request;
};

export const getCachedStudentDashboard = () =>
  getPrivateCachedData<{
    dashboard: unknown;
    remaining: unknown;
    rehearsalCounters: unknown;
  }>('student-dashboard');

export const getCachedJuniorDashboard = () =>
  getPrivateCachedData<{ dashboard: unknown }>('junior-dashboard');

export const getCachedStudentIssueBootstrap = () =>
  getPrivateCachedData<{ data: unknown }>('student-issue-bootstrap');

export const getCachedJuniorIssueBootstrap = () =>
  getPrivateCachedData<{ data: unknown }>('junior-issue-bootstrap');
import { supabase } from '../../lib/supabase';
