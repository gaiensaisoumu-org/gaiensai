import type { TicketCardItem } from '../../../features/tickets/IssuedTicketCardList';
import type { UserData } from '../../../types/types';

type StoredUserProfile = Exclude<UserData, null>;

export type StoredTicketCard = TicketCardItem & {
  relationshipId: number;
  affiliation: string;
};

const STUDENT_PROFILE_CACHE_PREFIX = 'students_profile_cache:v1:';
const STUDENT_TICKETS_CACHE_PREFIX = 'students_ticket_cards_cache:v1:';

const getProfileKey = (userId: string) =>
  `${STUDENT_PROFILE_CACHE_PREFIX}${userId}`;
const getTicketsKey = (userId: string) =>
  `${STUDENT_TICKETS_CACHE_PREFIX}${userId}`;

export const readCachedStudentProfile = (
  userId: string,
): StoredUserProfile | null => {
  try {
    const raw = window.localStorage.getItem(getProfileKey(userId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { profile?: StoredUserProfile };
    return parsed.profile ?? null;
  } catch {
    return null;
  }
};

export const writeCachedStudentProfile = (
  userId: string,
  profile: StoredUserProfile,
): void => {
  window.localStorage.setItem(
    getProfileKey(userId),
    JSON.stringify({
      profile,
      cachedAt: Date.now(),
    }),
  );
};

export const readCachedTicketCards = (
  userId: string,
): StoredTicketCard[] | null => {
  try {
    const raw = window.localStorage.getItem(getTicketsKey(userId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { tickets?: StoredTicketCard[] };
    if (!Array.isArray(parsed.tickets)) {
      return null;
    }
    return parsed.tickets;
  } catch {
    return null;
  }
};

export const writeCachedTicketCards = (
  userId: string,
  tickets: StoredTicketCard[],
): void => {
  window.localStorage.setItem(
    getTicketsKey(userId),
    JSON.stringify({
      tickets,
      cachedAt: Date.now(),
    }),
  );
};

export const deleteCachedTicketCard = (userId: string, code: string): void => {
  try {
    const tickets = readCachedTicketCards(userId);
    if (!tickets) {
      return;
    }
    const filtered = tickets.filter((t) => t.code !== code);
    writeCachedTicketCards(userId, filtered);
  } catch {
    // ignore
  }
};

export const markCachedTicketCardCancelled = (
  userId: string,
  code: string,
): void => {
  try {
    const tickets = readCachedTicketCards(userId);
    if (!tickets) {
      return;
    }
    const updated = tickets.map((t) =>
      t.code === code ? { ...t, status: 'cancelled' } : t,
    );
    writeCachedTicketCards(userId, updated as StoredTicketCard[]);
  } catch {
    // ignore
  }
};
