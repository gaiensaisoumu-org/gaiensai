/* eslint-disable no-console */
import { db } from './db.ts';

const insertOperationLogStmt = db.prepare(`
INSERT INTO operation_logs (created_at, location, operation_type, ticket_code, message, details)
VALUES (?, ?, ?, ?, ?, ?)
`);

const getOperationLogsStmt = db.prepare(`
SELECT id, created_at, location, operation_type, ticket_code, message, details
FROM operation_logs
ORDER BY id DESC
`);

function safeStringify(value: unknown) {
  if (value === undefined) {
    return null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(String(value));
  }
}

export function logOperation(
  location: string,
  operationType: string,
  ticketCode: string,
  message: string,
  ...details: unknown[]
) {
  const now = new Date().toISOString();
  const payload = details.length > 0 ? safeStringify(details) : null;

  insertOperationLogStmt.run(
    now,
    location,
    operationType,
    ticketCode,
    message,
    payload,
  );
  console.log(message, ...details);
}

export function getOperationLogs() {
  return getOperationLogsStmt.all() as Array<{
    id: number;
    created_at: string;
    location: string;
    operation_type: string;
    ticket_code: string;
    message: string;
    details: string | null;
  }>;
}
