import type { TicketCardStatus } from './IssuedTicketCardList';
import { resolveJuniorRelationshipName } from './juniorRelationship';

const TICKET_CACHE_PREFIX = 'ticket-display-cache:v1:';
const STUDENT_TICKETS_CACHE_PREFIX = 'students_ticket_cards_cache:v1:';
const JUNIOR_TICKETS_CACHE_PREFIX = 'junior_ticket_cards_cache:v1:';
const TICKET_CACHE_UPDATED_EVENT = 'ticket-display-cache:updated';
const DEFAULT_TICKET_STATUS: TicketCardStatus = 'unknown';

const getTicketCacheKey = (code: string): string =>
  `${TICKET_CACHE_PREFIX}${code}`;

const isTicketCardStatus = (value: unknown): value is TicketCardStatus =>
  value === 'valid' ||
  value === 'cancelled' ||
  value === 'used' ||
  value === 'missing' ||
  value === 'unknown';

const normalizeCachedTicketStatus = <T>(ticket: T): T => {
  if (!ticket || typeof ticket !== 'object') {
    return ticket;
  }

  const rawStatus = (ticket as { status?: unknown }).status;
  const status = isTicketCardStatus(rawStatus)
    ? rawStatus
    : DEFAULT_TICKET_STATUS;

  return {
    ...(ticket as Record<string, unknown>),
    status,
  } as T;
};

const normalizeLastOpenedAt = (value: unknown): number =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

const normalizeCachedTicket = <T>(
  ticket: T,
  fallbackLastOpenedAt: number,
): T => {
  const normalizedStatusTicket = normalizeCachedTicketStatus(ticket);
  if (!normalizedStatusTicket || typeof normalizedStatusTicket !== 'object') {
    return normalizedStatusTicket;
  }
  const rawLastOpenedAt = (normalizedStatusTicket as { lastOpenedAt?: unknown })
    .lastOpenedAt;
  const lastOpenedAt = Math.max(
    normalizeLastOpenedAt(rawLastOpenedAt),
    normalizeLastOpenedAt(fallbackLastOpenedAt),
  );
  const ticketObject = normalizedStatusTicket as Record<string, unknown>;
  const ticketTypeId = Number(ticketObject.ticketTypeId ?? -1);
  const relationshipId = Number(ticketObject.relationshipId ?? -1);
  const juniorRelationshipName = resolveJuniorRelationshipName(
    ticketTypeId,
    relationshipId,
  );

  return {
    ...ticketObject,
    ...(juniorRelationshipName !== null
      ? { relationshipName: juniorRelationshipName }
      : {}),
    lastOpenedAt,
  } as T;
};

const notifyTicketDisplayCacheUpdated = (code: string): void => {
  window.dispatchEvent(
    new CustomEvent<string>(TICKET_CACHE_UPDATED_EVENT, { detail: code }),
  );
};

export const subscribeTicketDisplayCacheUpdated = (
  callback: (code: string) => void,
): (() => void) => {
  const listener = (event: Event) => {
    const updatedCode = (event as CustomEvent<string>).detail;
    callback(updatedCode ?? '');
  };
  window.addEventListener(TICKET_CACHE_UPDATED_EVENT, listener);
  return () => {
    window.removeEventListener(TICKET_CACHE_UPDATED_EVENT, listener);
  };
};

export const readTicketDisplayCache = <T>(code: string): T | null => {
  try {
    const raw = window.localStorage.getItem(getTicketCacheKey(code));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as {
      ticket?: T;
      lastOpenedAt?: number;
      cachedAt?: number;
    };
    if (!parsed.ticket) {
      return null;
    }
    return normalizeCachedTicket(
      parsed.ticket,
      normalizeLastOpenedAt(parsed.lastOpenedAt ?? parsed.cachedAt),
    );
  } catch {
    return null;
  }
};

export const writeTicketDisplayCache = <T>(code: string, ticket: T): void => {
  const now = Date.now();

  let existingLastOpenedAt: number | undefined;
  try {
    const raw = window.localStorage.getItem(getTicketCacheKey(code));
    if (raw) {
      const parsed = JSON.parse(raw) as { lastOpenedAt?: number };
      existingLastOpenedAt = parsed.lastOpenedAt;
    }
  } catch {
    // ignore
  }

  const lastOpenedAt = normalizeLastOpenedAt(
    (ticket as { lastOpenedAt?: unknown }).lastOpenedAt ??
      existingLastOpenedAt ??
      now,
  );

  const normalizedTicket = normalizeCachedTicket(ticket, lastOpenedAt);

  window.localStorage.setItem(
    getTicketCacheKey(code),
    JSON.stringify({
      ticket: normalizedTicket,
      cachedAt: now,
      lastOpenedAt: lastOpenedAt,
    }),
  );
  notifyTicketDisplayCacheUpdated(code);
};

export const touchTicketDisplayCacheOpenedAt = (code: string): void => {
  try {
    const raw = window.localStorage.getItem(getTicketCacheKey(code));
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as {
      ticket?: Record<string, unknown>;
      cachedAt?: number;
      lastOpenedAt?: number;
    };
    if (!parsed.ticket) {
      return;
    }
    const now = Date.now();
    parsed.ticket = normalizeCachedTicket(parsed.ticket, now);
    parsed.lastOpenedAt = now;
    window.localStorage.setItem(
      getTicketCacheKey(code),
      JSON.stringify(parsed),
    );
    notifyTicketDisplayCacheUpdated(code);
  } catch {
    // ignore
  }
};

export const listTicketDisplayCache = <T>(): T[] => {
  const items: Array<{ ticket: T; lastOpenedAt: number }> = [];

  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(TICKET_CACHE_PREFIX)) {
      continue;
    }

    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        continue;
      }
      const parsed = JSON.parse(raw) as {
        ticket?: T;
        cachedAt?: number;
        lastOpenedAt?: number;
      };
      if (!parsed.ticket) {
        continue;
      }
      const lastOpenedAt = normalizeLastOpenedAt(
        parsed.lastOpenedAt ?? parsed.cachedAt,
      );
      items.push({
        ticket: normalizeCachedTicket(parsed.ticket, lastOpenedAt),
        lastOpenedAt,
      });
    } catch {
      // Ignore malformed entries.
    }
  }

  return items
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .map((item) => item.ticket);
};

export const deleteTicketDisplayCache = (code: string): void => {
  try {
    window.localStorage.removeItem(getTicketCacheKey(code));
    notifyTicketDisplayCacheUpdated(code);
  } catch {
    // ignore
  }
};

/** この端末に保存されたチケット表示履歴をすべて削除する。 */
export const clearTicketDisplayCache = (): void => {
  const keysToRemove: string[] = [];

  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith(TICKET_CACHE_PREFIX)) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore errors and continue clearing the remaining entries.
    }
  }

  if (keysToRemove.length > 0) {
    notifyTicketDisplayCacheUpdated('');
  }
};

/**
 * この端末に保存されたチケット表示履歴と、マイページ用のチケット一覧キャッシュを削除する。
 * チケット自体のキャンセルやサーバー上のデータ変更は行わない。
 */
export const clearTicketHistoryCaches = (): void => {
  const keysToRemove: string[] = [];
  const cachePrefixes = [
    TICKET_CACHE_PREFIX,
    STUDENT_TICKETS_CACHE_PREFIX,
    JUNIOR_TICKETS_CACHE_PREFIX,
  ];

  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key && cachePrefixes.some((prefix) => key.startsWith(prefix))) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore errors and continue clearing the remaining entries.
    }
  }

  if (keysToRemove.length > 0) {
    notifyTicketDisplayCacheUpdated('');
  }
};

/**
 * この端末のローカルストレージを削除する。
 * 管理画面とSupabaseの認証情報、チケットのキャンセル状態、サーバー上のデータは変更しない。
 */
export const clearAllUserCaches = (): void => {
  const keysToRemove: string[] = [];

  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    const isPreservedKey =
      key?.startsWith('admin_control_panel_session') ||
      /^sb-.+-auth-token$/.test(key ?? '');
    if (key && !isPreservedKey) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore errors and continue clearing the remaining entries.
    }
  }

  if (keysToRemove.length > 0) {
    notifyTicketDisplayCacheUpdated('');
  }
};

export const markTicketDisplayCacheCancelled = (code: string): void => {
  try {
    const raw = window.localStorage.getItem(getTicketCacheKey(code));
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as {
      ticket?: Record<string, unknown>;
      cachedAt?: number;
    };
    if (!parsed.ticket) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (parsed.ticket as any).status = 'cancelled';
    window.localStorage.setItem(
      getTicketCacheKey(code),
      JSON.stringify(parsed),
    );
    notifyTicketDisplayCacheUpdated(code);
  } catch {
    // ignore
  }
};

/**
 * 指定されたタイムスタンプ以前に作成・更新されたキャッシュを削除する
 * @param threshold タイムスタンプの閾値 (ms)
 */
export const clearTicketDisplayCacheBefore = (threshold: number): void => {
  const keysToRemove: string[] = [];
  // localStorage の走査中に項目を削除するとインデックスがずれるため、一旦キーを収集する
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith(TICKET_CACHE_PREFIX)) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        continue;
      }
      const parsed = JSON.parse(raw) as {
        lastOpenedAt?: number;
        cachedAt?: number;
      };
      const timestamp = normalizeLastOpenedAt(
        parsed.lastOpenedAt ?? parsed.cachedAt,
      );
      if (timestamp <= threshold) {
        window.localStorage.removeItem(key);
        // キャッシュが削除されたことを他のコンポーネントに通知する
        notifyTicketDisplayCacheUpdated(key.replace(TICKET_CACHE_PREFIX, ''));
      }
    } catch {
      // パースできない異常なデータも削除対象とする
      window.localStorage.removeItem(key);
    }
  }
};
