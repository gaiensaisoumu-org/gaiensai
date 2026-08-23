import { db } from './db.ts';

const getTicket = db.prepare(
  'SELECT used_at, count FROM tickets WHERE id = ?;',
);
const insertTicket = db.prepare(
  'INSERT INTO tickets (id, used_at, count) VALUES (?, ?, ?)',
);
const updateTicket = db.prepare(
  'UPDATE tickets SET used_at = ?, count = ? WHERE id = ?',
);

const getTicketStatusStmt = db.prepare(
  'SELECT status FROM ticket_status_cache WHERE code = ?;',
);

const getTicketStatusCacheSummaryStmt = db.prepare(`
SELECT COUNT(*) as total, MAX(synced_at) as lastSyncedAt
FROM ticket_status_cache
`);

const clearTicketStatusCacheStmt = db.prepare(
  'DELETE FROM ticket_status_cache',
);

const upsertTicketStatusStmt = db.prepare(`
INSERT INTO ticket_status_cache (code, status, synced_at)
VALUES (?, ?, ?)
ON CONFLICT(code) DO UPDATE SET
  status = excluded.status,
  synced_at = excluded.synced_at
`);

const logScanStmt = db.prepare(`
INSERT INTO ticket_scan_logs (ticket_code, scanned_at, result, count)
VALUES (?, ?, ?, ?)
`);

const getScanLogByIdStmt = db.prepare(`
SELECT id, ticket_code FROM ticket_scan_logs WHERE id = ?
`);

const deleteScanLogByIdStmt = db.prepare(`
DELETE FROM ticket_scan_logs WHERE id = ?
`);

const getEntryCountStmt = db.prepare('SELECT SUM(count) as total FROM tickets');
const getRecentLogsStmt = db.prepare(`
SELECT id, ticket_code, scanned_at, result, count FROM ticket_scan_logs
ORDER BY id DESC LIMIT 5
`);

const getAllLogsStmt = db.prepare(`
SELECT id, ticket_code, scanned_at, result, count FROM ticket_scan_logs
ORDER BY id DESC
`);

const getAllTicketsStmt = db.prepare(`
SELECT id, used_at, count FROM tickets
ORDER BY used_at DESC
`);

const updateScanLogCountStmt = db.prepare(`
UPDATE ticket_scan_logs SET count = ? WHERE id = ?
`);

const updateTicketCountStmt = db.prepare(`
UPDATE tickets SET count = ? WHERE id = ?
`);

const deleteTicketByIdStmt = db.prepare(`
DELETE FROM tickets WHERE id = ?
`);

const getMaxScanLogCountStmt = db.prepare(`
SELECT MAX(count) as maxCount FROM ticket_scan_logs
WHERE ticket_code LIKE ? || '.%' OR ticket_code = ?
`);

const getScanLogCountByCodeStmt = db.prepare(`
SELECT COUNT(*) as total FROM ticket_scan_logs
WHERE (ticket_code LIKE ? || '.%' OR ticket_code = ?)
  AND result IN ('success', 'reentry')
`);

type UseTicketOptions = {
  allowUnknown?: boolean;
};

type TicketStatusCacheRow = {
  code: string;
  status: string;
};

function normalizeTicketCode(raw: string) {
  return raw.split('.')[0].replace(/-/g, '').trim();
}

function readTicketStatus(code: string) {
  return getTicketStatusStmt.get(code) as { status: string } | undefined;
}

export function checkTicketExists(id: string) {
  const existing = getTicket.get(id) as
    { used_at: string; count: number } | undefined;
  return existing;
}

export function updateTicketUsedAndCount(id: string, count: number = 1) {
  const now = new Date().toISOString();
  const existing = checkTicketExists(id);

  if (existing) {
    // 人数の多い方を記録
    const maxCount = Math.max(existing.count, count);
    updateTicket.run(now, maxCount, id);
  }
}

export function replaceTicketStatusCache(rows: TicketStatusCacheRow[]) {
  const syncedAt = new Date().toISOString();
  clearTicketStatusCacheStmt.run();

  let imported = 0;
  for (const row of rows) {
    const code = normalizeTicketCode(row.code);
    const status = row.status.trim();
    if (!code || !status) {
      continue;
    }
    upsertTicketStatusStmt.run(code, status, syncedAt);
    imported += 1;
  }

  return {
    imported,
    syncedAt,
  };
}

export function getTicketStatusCacheSummary() {
  const row = getTicketStatusCacheSummaryStmt.get() as
    { total: number | null; lastSyncedAt: string | null } | undefined;
  return {
    total: row?.total ?? 0,
    lastSyncedAt: row?.lastSyncedAt ?? null,
  };
}

export function useTicket(
  id: string,
  count: number = 1,
  options?: UseTicketOptions,
) {
  const normalizedId = normalizeTicketCode(id);
  const cachedStatus = readTicketStatus(normalizedId);
  const allowUnknown = Boolean(options?.allowUnknown);

  if (!cachedStatus && !allowUnknown) {
    return { status: 'unknown', usedAt: null };
  }

  if (cachedStatus && cachedStatus.status !== 'valid') {
    return {
      status: 'invalid',
      usedAt: null,
      masterStatus: cachedStatus.status,
    };
  }

  const existing = checkTicketExists(normalizedId);

  if (existing) {
    // 既存チケット、duplicate として返すのみ（tickets は更新しない）
    return { status: 'duplicate', usedAt: existing.used_at };
  }

  // 新規チケット、初回入場のみ tickets に挿入
  const now = new Date().toISOString();
  insertTicket.run(normalizedId, now, count);
  return { status: 'success', usedAt: null };
}

export function logTicketScan(code: string, result: string, count: number = 1) {
  const now = new Date().toISOString();
  logScanStmt.run(code, now, result, count);
  const logId = db.lastInsertRowId;
  return logId;
}

export function getEntryCount(): number {
  const result = getEntryCountStmt.get() as { total: number | null };
  return result.total ?? 0;
}

function mapScanLogs(result: unknown): Array<{
  id: number;
  ticket_code: string;
  scanned_at: string;
  result: string;
  count: number;
}> {
  return result as Array<{
    id: number;
    ticket_code: string;
    scanned_at: string;
    result: string;
    count: number;
  }>;
}

export function getScanLogs(options?: { all?: boolean }) {
  const result = options?.all ? getAllLogsStmt.all() : getRecentLogsStmt.all();
  return mapScanLogs(result);
}

export function getRecentScanLogs() {
  const result = getRecentLogsStmt.all();
  return mapScanLogs(result);
}

export function getTickets() {
  return getAllTicketsStmt.all() as Array<{
    id: string;
    used_at: string | null;
    count: number;
  }>;
}

export function updateScanLogCount(logId: number, count: number) {
  if (count < 1) {
    count = 1;
  }
  updateScanLogCountStmt.run(count, logId);
}

export function updateTicketCount(raw: string, count: number) {
  const code = raw.split('.')[0];

  if (count < 1) {
    count = 1;
  }

  // ticket_scan_logs から同じコードのレコードをすべて取得し、countの最大値を取得
  const scanLogResult = getMaxScanLogCountStmt.get(code, code) as
    { maxCount: number | null } | undefined;
  const maxCount = scanLogResult?.maxCount ?? 0;

  updateTicketCountStmt.run(maxCount, code);
}

// 手順: 1. ticket_scan_logsから該当のidの読み取り履歴を削除.
//      2. ticket_scan_logsで、削除したチケットコードがまだ他にあるかを確認.
//      3. ある場合は、ticketsの人数を更新(ticket_scan_logsの人数のうちの最大値).
//      4. ない場合は、ticketsで該当のチケットコードを削除.

export function deleteScanLogAndUpdateTicket(logId: number) {
  const target = getScanLogByIdStmt.get(logId) as
    { id: number; ticket_code: string } | undefined;

  if (!target) {
    return { ok: false, code: null, remaining: 0 };
  }

  const code = target.ticket_code.split('.')[0];
  deleteScanLogByIdStmt.run(logId);

  const remainingResult = getScanLogCountByCodeStmt.get(code, code) as
    { total: number | null } | undefined;
  const remaining = remainingResult?.total ?? 0;

  if (remaining > 0) {
    const scanLogResult = getMaxScanLogCountStmt.get(code, code) as
      { maxCount: number | null } | undefined;
    const maxCount = scanLogResult?.maxCount ?? 0;
    updateTicketCountStmt.run(maxCount, code);
  } else {
    deleteTicketByIdStmt.run(code);
  }

  return { ok: true, code, remaining };
}
