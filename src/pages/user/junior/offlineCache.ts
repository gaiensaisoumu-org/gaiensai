import type { UserData } from '../../../types/types';
import type { TicketCardItem } from '../../../features/tickets/IssuedTicketCardList';

type StoredUserProfile = Exclude<UserData, null>;

const JUNIOR_PROFILE_CACHE_PREFIX = 'junior_profile_cache:v1:';
const JUNIOR_TICKETS_CACHE_PREFIX = 'junior_ticket_cards_cache:v1:';

const getProfileKey = (userId: string) =>
  `${JUNIOR_PROFILE_CACHE_PREFIX}${userId}`;
const getTicketsKey = (userId: string) =>
  `${JUNIOR_TICKETS_CACHE_PREFIX}${userId}`;

export type StoredJuniorTicketCard = TicketCardItem & {
  relationshipId: number;
};

export const readCachedJuniorProfile = (
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

export const writeCachedJuniorProfile = (
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

export const readCachedJuniorTicketCards = (
  userId: string,
): StoredJuniorTicketCard[] | null => {
  try {
    const raw = window.localStorage.getItem(getTicketsKey(userId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { tickets?: StoredJuniorTicketCard[] };
    return Array.isArray(parsed.tickets) ? parsed.tickets : null;
  } catch {
    return null;
  }
};

export const writeCachedJuniorTicketCards = (
  userId: string,
  tickets: StoredJuniorTicketCard[],
): void => {
  try {
    window.localStorage.setItem(
      getTicketsKey(userId),
      JSON.stringify({ tickets, cachedAt: Date.now() }),
    );
  } catch {
    // キャッシュ書き込み失敗は表示に影響させない
  }
};
