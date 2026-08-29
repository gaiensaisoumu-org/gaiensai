import type { TicketDecodedDisplaySeed } from './ticketCodeDecode';
import { formatTicketTypeLabel } from './formatTicketTypeLabel';
import { resolveJuniorRelationshipName } from './juniorRelationship';
import performancesSnapshot from '../../generated/performances-static.json';
import { getCachedAppData } from '../cache/appData';

const SCAN_TICKET_MASTER_CACHE_KEY = 'scan-ticket-master:v4';
const SCAN_TICKET_MASTER_CACHE_TTL_MS = 5 * 60 * 1000;

type ScanPerformance = {
  id: number;
  class_name: string;
  title: string | null;
};

type ScanGymPerformance = {
  id: number;
  group_name: string;
  round_name: string;
  start_at: string | null;
  end_at: string | null;
};

type ScanSchedule = {
  id: number;
  round_name: string;
  start_at: string | null;
};

export type ScanRehearsal = {
  class_id: number;
  round_id: number;
  round_name: string;
  start_time: string;
  end_time: string;
};

type ScanNamedMaster = {
  id: number;
  name: string;
};

type ScanTicketType = ScanNamedMaster & {
  type?: string | null;
};

export type ScanTicketMaster = {
  performances: ScanPerformance[];
  gymPerformances: ScanGymPerformance[];
  schedules: ScanSchedule[];
  rehearsals: ScanRehearsal[];
  ticketTypes: ScanTicketType[];
  relationships: ScanNamedMaster[];
  showLengthMinutes: number;
  fetchedAt: number;
};

export type ResolvedScanTicketDisplay = {
  performanceName: string;
  performanceTitle: string | null;
  scheduleName: string;
  scheduleDate: string;
  scheduleTime: string;
  scheduleEndTime: string;
  ticketTypeLabel: string;
  relationshipName: string;
};

let inMemoryMaster: ScanTicketMaster | null = null;

const isFresh = (fetchedAt: number): boolean =>
  Date.now() - fetchedAt <= SCAN_TICKET_MASTER_CACHE_TTL_MS;

const readCache = (): ScanTicketMaster | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(SCAN_TICKET_MASTER_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as ScanTicketMaster;
    if (!parsed || !Array.isArray(parsed.performances)) {
      return null;
    }
    const gymPerformances = Array.isArray(
      (parsed as { gymPerformances?: unknown }).gymPerformances,
    )
      ? ((parsed as { gymPerformances?: ScanGymPerformance[] })
          .gymPerformances ?? [])
      : [];
    const rehearsals = Array.isArray(
      (parsed as { rehearsals?: unknown }).rehearsals,
    )
      ? ((parsed as { rehearsals?: ScanRehearsal[] }).rehearsals ?? [])
      : [];
    if (!isFresh(Number(parsed.fetchedAt ?? 0))) {
      return null;
    }
    return {
      ...parsed,
      gymPerformances,
      rehearsals,
    };
  } catch {
    return null;
  }
};

const writeCache = (master: ScanTicketMaster): void => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(
      SCAN_TICKET_MASTER_CACHE_KEY,
      JSON.stringify(master),
    );
  } catch {
    // ignore cache write errors
  }
};

export const getStaticScanTicketMaster = (): ScanTicketMaster => {
  const snapshot = performancesSnapshot as {
    performances?: ScanPerformance[];
    gymPerformances?: ScanGymPerformance[];
    schedules?: ScanSchedule[];
    ticketTypes?: ScanTicketType[];
    relationships?: ScanNamedMaster[];
    showLengthMinutes?: number | null;
  };
  return {
    performances: snapshot.performances ?? [],
    gymPerformances: snapshot.gymPerformances ?? [],
    schedules: snapshot.schedules ?? [],
    rehearsals: [],
    ticketTypes: snapshot.ticketTypes ?? [],
    relationships: snapshot.relationships ?? [],
    showLengthMinutes: Number(snapshot.showLengthMinutes ?? 0),
    fetchedAt: Date.now(),
  };
};

const fetchMasterFromCache = async (): Promise<ScanTicketMaster> => {
  const master = getStaticScanTicketMaster();
  const appData = await getCachedAppData();
  return {
    ...master,
    rehearsals: (
      appData.rehearsals as Array<
        ScanRehearsal & {
          type: string;
          is_active: boolean;
        }
      >
    ).filter(
      (rehearsal) => rehearsal.type === 'unofficial' && rehearsal.is_active,
    ),
  };
};

export const preloadScanTicketMaster = async (): Promise<ScanTicketMaster> => {
  if (inMemoryMaster && isFresh(inMemoryMaster.fetchedAt)) {
    return inMemoryMaster;
  }

  const cached = readCache();
  if (cached) {
    inMemoryMaster = cached;
    return cached;
  }

  const fetched = await fetchMasterFromCache();
  inMemoryMaster = fetched;
  writeCache(fetched);
  return fetched;
};

export const resolveScanTicketDisplay = (
  decoded: TicketDecodedDisplaySeed,
  master: ScanTicketMaster,
): ResolvedScanTicketDisplay => {
  const isAdmissionOnly =
    decoded.performanceId === 0 && decoded.scheduleId === 0;
  const isGymPerformance =
    decoded.performanceId > 0 && decoded.scheduleId === 0;

  const performance = master.performances.find(
    (item) => item.id === decoded.performanceId,
  );
  const gymPerformance = master.gymPerformances.find(
    (item) => item.id === decoded.performanceId,
  );
  const schedule = master.schedules.find(
    (item) => item.id === decoded.scheduleId,
  );
  const ticketType = master.ticketTypes.find(
    (item) => item.id === decoded.ticketTypeId,
  );
  const ticketTypeLabel = formatTicketTypeLabel({
    type: ticketType?.type,
    name: ticketType?.name,
    separator: ' ',
  });
  const relationship = master.relationships.find(
    (item) => item.id === decoded.relationshipId,
  );
  const relationshipName =
    resolveJuniorRelationshipName(
      decoded.ticketTypeId,
      decoded.relationshipId,
    ) ??
    relationship?.name ??
    '-';
  const isRehearsalTicket = ticketType?.name === 'クラス公演(リハーサル)';
  const rehearsal = master.rehearsals.find(
    (item) =>
      item.class_id === decoded.performanceId &&
      item.round_id === decoded.scheduleId,
  );

  if (isAdmissionOnly) {
    return {
      performanceName: '入場専用券',
      performanceTitle: null,
      scheduleName: '',
      scheduleDate: '',
      scheduleTime: '',
      scheduleEndTime: '',
      ticketTypeLabel,
      relationshipName,
    };
  }

  if (isGymPerformance) {
    const startAt = gymPerformance?.start_at
      ? new Date(gymPerformance.start_at)
      : null;
    const endAt = gymPerformance?.end_at
      ? new Date(gymPerformance.end_at)
      : null;

    return {
      performanceName: gymPerformance?.group_name ?? '-',
      performanceTitle: null,
      scheduleName: gymPerformance?.round_name ?? '-',
      scheduleDate: startAt
        ? startAt.toLocaleDateString('ja-JP', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          })
        : '-',
      scheduleTime: startAt
        ? startAt.toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '-',
      scheduleEndTime: endAt
        ? endAt.toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '-',
      ticketTypeLabel,
      relationshipName,
    };
  }

  const startAt = isRehearsalTicket
    ? rehearsal?.start_time
      ? new Date(rehearsal.start_time)
      : null
    : schedule?.start_at
      ? new Date(schedule.start_at)
      : null;
  const endAt = isRehearsalTicket
    ? rehearsal?.end_time
      ? new Date(rehearsal.end_time)
      : null
    : null;
  const showLengthMinutes = Number(master.showLengthMinutes);
  const calculatedEndAt =
    startAt && !isRehearsalTicket && Number.isFinite(showLengthMinutes)
      ? new Date(startAt.getTime() + showLengthMinutes * 60 * 1000)
      : null;
  const displayEndAt = endAt ?? calculatedEndAt;

  return {
    performanceName: performance?.class_name ?? '-',
    performanceTitle: performance?.title ?? null,
    scheduleName: isRehearsalTicket
      ? (rehearsal?.round_name ?? '不明なリハーサル')
      : (schedule?.round_name ?? '-'),
    scheduleDate: startAt
      ? startAt.toLocaleDateString('ja-JP', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
      : '-',
    scheduleTime: startAt
      ? startAt.toLocaleTimeString('ja-JP', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '-',
    scheduleEndTime: displayEndAt
      ? displayEndAt.toLocaleTimeString('ja-JP', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '-',
    ticketTypeLabel,
    relationshipName,
  };
};
