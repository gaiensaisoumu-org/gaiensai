import type { ScanRecord } from './scanSync';

const SCAN_RECORD_CACHE_KEY = 'admin_scan_records_cache:v1';
const PENDING_SYNC_OPERATIONS_KEY = 'admin_scan_pending_operations:v1';

export type PendingSyncOperation =
  | {
      opId: string;
      type: 'scanLog';
      localRecordId: number;
      ticketCode: string;
      ticketId: string;
      result: string;
      count: number;
      scannedAt: string;
    }
  | {
      opId: string;
      type: 'countUpdate';
      logId: number;
      code: string;
      count: number;
    }
  | {
      opId: string;
      type: 'deleteLog';
      logId: number;
    };

const safeJsonParse = <T>(raw: string | null): T | null => {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const toRecordTime = (record: ScanRecord) => {
  const parsed = new Date(record.scanned_at).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const sortRecords = (records: ScanRecord[]) =>
  [...records].sort((a, b) => toRecordTime(b) - toRecordTime(a));

const normalizeTicketId = (ticketCode: string) =>
  ticketCode.split('.')[0].replace(/-/g, '');

const createLocalRecordId = () =>
  -Date.now() - Math.floor(Math.random() * 1000);

const createOpId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const writeCachedScanRecords = (records: ScanRecord[]) => {
  window.localStorage.setItem(
    SCAN_RECORD_CACHE_KEY,
    JSON.stringify({ records: sortRecords(records), cachedAt: Date.now() }),
  );
};

export const readCachedScanRecords = (): ScanRecord[] => {
  const parsed = safeJsonParse<{ records?: ScanRecord[] }>(
    window.localStorage.getItem(SCAN_RECORD_CACHE_KEY),
  );
  if (!parsed || !Array.isArray(parsed.records)) {
    return [];
  }
  return sortRecords(parsed.records);
};

export const readRecentCachedScanRecords = (limit = 5): ScanRecord[] =>
  readCachedScanRecords().slice(0, limit);

export const replaceCachedRecordsWithServerRecords = (
  serverRecords: ScanRecord[],
): ScanRecord[] => {
  const pendingLocal = readCachedScanRecords().filter(
    (record) => record.id < 0,
  );
  const operations = readPendingSyncOperations();
  const deletedIds = new Set<number>();
  const countOverrides = new Map<number, number>();

  operations.forEach((operation) => {
    if (operation.type === 'deleteLog') {
      deletedIds.add(operation.logId);
    } else if (operation.type === 'countUpdate') {
      countOverrides.set(operation.logId, operation.count);
    }
  });

  const patchedServerRecords = serverRecords
    .filter((record) => !deletedIds.has(record.id))
    .map((record) => {
      const override = countOverrides.get(record.id);
      if (override === undefined) {
        return record;
      }
      return { ...record, count: override };
    });

  const merged = sortRecords([...patchedServerRecords, ...pendingLocal]);
  writeCachedScanRecords(merged);
  return merged;
};

export const appendScanRecordToCache = (input: {
  id?: number;
  ticket_code: string;
  scanned_at?: string;
  result: string;
  count: number;
}) => {
  const records = readCachedScanRecords();
  const nextRecord: ScanRecord = {
    id: input.id ?? createLocalRecordId(),
    ticket_code: input.ticket_code,
    scanned_at: input.scanned_at ?? new Date().toISOString(),
    result: input.result,
    count: input.count,
  };

  const index = records.findIndex((record) => record.id === nextRecord.id);
  if (index >= 0) {
    records[index] = nextRecord;
  } else {
    records.push(nextRecord);
  }

  writeCachedScanRecords(records);
  return nextRecord;
};

export const updateCachedRecordCount = (logId: number, count: number) => {
  const records = readCachedScanRecords();
  const nextRecords = records.map((record) =>
    record.id === logId ? { ...record, count } : record,
  );
  writeCachedScanRecords(nextRecords);
  return nextRecords;
};

export const removeCachedRecord = (logId: number) => {
  const records = readCachedScanRecords();
  const nextRecords = records.filter((record) => record.id !== logId);
  writeCachedScanRecords(nextRecords);
  return nextRecords;
};

const writePendingOperations = (operations: PendingSyncOperation[]) => {
  window.localStorage.setItem(
    PENDING_SYNC_OPERATIONS_KEY,
    JSON.stringify({ operations, cachedAt: Date.now() }),
  );
};

export const readPendingSyncOperations = (): PendingSyncOperation[] => {
  const parsed = safeJsonParse<{ operations?: PendingSyncOperation[] }>(
    window.localStorage.getItem(PENDING_SYNC_OPERATIONS_KEY),
  );
  if (!parsed || !Array.isArray(parsed.operations)) {
    return [];
  }
  return parsed.operations;
};

export const clearCachedScanRecords = () => {
  window.localStorage.removeItem(SCAN_RECORD_CACHE_KEY);
};

export const clearPendingSyncOperations = () => {
  window.localStorage.removeItem(PENDING_SYNC_OPERATIONS_KEY);
};

export const enqueuePendingScanLog = (input: {
  localRecordId: number;
  ticketCode: string;
  result: string;
  count: number;
  scannedAt?: string;
}) => {
  const operations = readPendingSyncOperations();
  operations.push({
    opId: createOpId(),
    type: 'scanLog',
    localRecordId: input.localRecordId,
    ticketCode: input.ticketCode,
    ticketId: normalizeTicketId(input.ticketCode),
    result: input.result,
    count: input.count,
    scannedAt: input.scannedAt ?? new Date().toISOString(),
  });
  writePendingOperations(operations);
  return operations;
};

export const enqueuePendingCountUpdate = (
  logId: number,
  code: string,
  count: number,
) => {
  const operations = readPendingSyncOperations();
  const next = operations.filter(
    (operation) =>
      !(operation.type === 'countUpdate' && operation.logId === logId),
  );
  next.push({
    opId: createOpId(),
    type: 'countUpdate',
    logId,
    code,
    count,
  });
  writePendingOperations(next);
  return next;
};

export const enqueuePendingDeleteLog = (logId: number) => {
  const operations = readPendingSyncOperations();
  const next = operations.filter((operation) => {
    if (operation.type === 'scanLog') {
      return operation.localRecordId !== logId;
    }
    if (operation.type === 'countUpdate') {
      return operation.logId !== logId;
    }
    if (operation.type === 'deleteLog') {
      return operation.logId !== logId;
    }
    return true;
  });

  if (logId > 0) {
    next.push({
      opId: createOpId(),
      type: 'deleteLog',
      logId,
    });
  }

  writePendingOperations(next);
  return next;
};

export const clearPendingOperationsForLog = (logId: number) => {
  const operations = readPendingSyncOperations();
  const next = operations.filter((operation) => {
    if (operation.type === 'scanLog') {
      return operation.localRecordId !== logId;
    }
    if (operation.type === 'countUpdate') {
      return operation.logId !== logId;
    }
    if (operation.type === 'deleteLog') {
      return operation.logId !== logId;
    }
    return true;
  });
  writePendingOperations(next);
  return next;
};

export const updatePendingScanLogCount = (
  localRecordId: number,
  count: number,
) => {
  const operations = readPendingSyncOperations();
  const next = operations.map((operation) => {
    if (
      operation.type === 'scanLog' &&
      operation.localRecordId === localRecordId
    ) {
      return { ...operation, count };
    }
    return operation;
  });
  writePendingOperations(next);
  return next;
};

export const replaceCachedRecordId = (fromId: number, toId: number) => {
  const records = readCachedScanRecords();
  const nextRecords = records.map((record) =>
    record.id === fromId ? { ...record, id: toId } : record,
  );
  writeCachedScanRecords(nextRecords);
  return nextRecords;
};

export const dropPendingOperation = (opId: string) => {
  const operations = readPendingSyncOperations();
  const next = operations.filter((operation) => operation.opId !== opId);
  writePendingOperations(next);
  return next;
};

export const getPendingOperationCount = () =>
  readPendingSyncOperations().length;

export const getOfflineLastUsedAt = (ticketId: string): Date | null => {
  const normalizedId = normalizeTicketId(ticketId);
  const matched = readCachedScanRecords()
    .filter((record) => {
      if (!(record.result === 'success' || record.result === 'reentry')) {
        return false;
      }
      return normalizeTicketId(record.ticket_code) === normalizedId;
    })
    .sort((a, b) => toRecordTime(b) - toRecordTime(a))[0];

  if (!matched) {
    return null;
  }

  const parsed = new Date(matched.scanned_at);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const estimateEntryCountFromRecords = (records: ScanRecord[]) => {
  const maxByTicketId = new Map<string, number>();

  records.forEach((record) => {
    if (!(record.result === 'success' || record.result === 'reentry')) {
      return;
    }
    const ticketId = normalizeTicketId(record.ticket_code);
    const current = maxByTicketId.get(ticketId) ?? 0;
    maxByTicketId.set(ticketId, Math.max(current, record.count ?? 1));
  });

  return [...maxByTicketId.values()].reduce((sum, count) => sum + count, 0);
};

export const inferOfflineTicketStatus = (ticketId: string) => {
  const lastUsedAt = getOfflineLastUsedAt(ticketId);
  if (!lastUsedAt) {
    return { ticketStatus: 'success', ticketUsedAt: null, lastUsedAt: null };
  }
  return {
    ticketStatus: 'duplicate',
    ticketUsedAt: lastUsedAt.toLocaleString(),
    lastUsedAt,
  };
};
