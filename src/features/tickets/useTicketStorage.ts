import { useCallback } from 'preact/hooks';
import type { TicketCardStatus } from './IssuedTicketCardList';
import {
  decodeTicketCodeWithEnv,
  toTicketDecodedDisplaySeed,
} from './ticketCodeDecode';
import {
  readTicketDisplayCache,
  writeTicketDisplayCache,
} from './ticketDisplayCache';
import { resolveJuniorRelationshipName } from './juniorRelationship';

export interface TicketStorageMetadata {
  performanceName: string;
  performanceTitle: string | null;
  scheduleName: string;
  scheduleDate: string;
  scheduleTime: string;
  scheduleEndTime: string;
  rehearsalEndAt?: string | null;
  isOfficialRehearsal?: boolean;
  ticketTypeLabel: string;
  relationshipName: string;
  relationshipId: number;
  ticketName?: string | null;
}

export const useTicketStorage = () => {
  const saveTicketToCache = useCallback(
    async (
      code: string,
      signature: string,
      metadata: TicketStorageMetadata,
      status: TicketCardStatus = 'valid',
    ) => {
      try {
        const decodedRaw = await decodeTicketCodeWithEnv(code);
        const decoded = toTicketDecodedDisplaySeed(decodedRaw);

        const existing = readTicketDisplayCache<{ lastOpenedAt?: number }>(
          code,
        );

        const ticketCacheEntry = {
          relationshipId: decoded?.relationshipId ?? metadata.relationshipId,
          code,
          signature,
          serial: decoded?.serial,
          affiliation: decoded?.affiliation ?? '-',
          performanceId: decoded?.performanceId ?? 0,
          scheduleId: decoded?.scheduleId ?? 0,
          ticketTypeId: decoded?.ticketTypeId ?? 0,
          year: decoded?.year ?? '',
          performanceName: metadata.performanceName,
          performanceTitle: metadata.performanceTitle,
          scheduleName: metadata.scheduleName,
          scheduleDate: metadata.scheduleDate,
          scheduleTime: metadata.scheduleTime,
          scheduleEndTime: metadata.scheduleEndTime,
          rehearsalEndAt: metadata.rehearsalEndAt ?? null,
          isOfficialRehearsal: metadata.isOfficialRehearsal ?? false,
          ticketTypeLabel: metadata.ticketTypeLabel,
          relationshipName:
            resolveJuniorRelationshipName(
              decoded?.ticketTypeId ?? 0,
              decoded?.relationshipId ?? metadata.relationshipId,
            ) ?? metadata.relationshipName,
          status,
          ticketName:
            metadata.ticketName ??
            (existing as { ticketName?: string | null } | null)?.ticketName ??
            null,
          lastOpenedAt: existing?.lastOpenedAt ?? Date.now(),
        };
        writeTicketDisplayCache(code, ticketCacheEntry);
      } catch (error) {
        // キャッシュ書き込みの失敗は致命的ではないため無視
      }
    },
    [],
  );

  return { saveTicketToCache };
};
