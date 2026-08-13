import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { decodeTicketCode } from '../supabase/functions/_shared/decodeTicketCode.ts';

type TicketRow = {
  id: string;
  code: string;
  ticket_type: number;
  relationship: number;
  status: string;
  user_id: string;
  created_at: string;
};

type UserRow = { id: string; affiliation: number | null };
type ClassTicketRow = { id: string; class_id: number; round_id: number };
type GymTicketRow = { id: string; performance_id: number };

const loadDotEnv = async (): Promise<void> => {
  try {
    const text = await Deno.readTextFile(new URL('./.env', import.meta.url));
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      const separator = line.indexOf('=');
      if (separator <= 0) {
        continue;
      }

      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      if (!Deno.env.has(key)) {
        Deno.env.set(key, value);
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
};

const env = (name: string, ...fallbacks: string[]): string => {
  const value = [name, ...fallbacks]
    .map((key) => Deno.env.get(key))
    .find(Boolean);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

await loadDotEnv();

const chunk = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

const fetchAll = async <T>(
  client: SupabaseClient,
  table: string,
  select: string,
) => {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from(table)
      .select(select)
      .range(from, from + 999);
    if (error) {
      throw error;
    }
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) {
      return rows;
    }
  }
};

const args = new Set(Deno.args);
const sinceIndex = Deno.args.indexOf('--since');
const since = sinceIndex >= 0 ? Deno.args[sinceIndex + 1] : undefined;
const targetTicketTypes = new Set([1, 2, 3, 4]);

const client = createClient(
  env('SUPABASE_URL', 'VITE_SUPABASE_URL'),
  env('SUPABASE_SERVICE_ROLE_KEY', 'FOR_ISSUE_TICKETS_SUPABASE_SECRET_KEY'),
);
let tickets = await fetchAll<TicketRow>(
  client,
  'tickets',
  'id,code,ticket_type,relationship,status,user_id,created_at',
);
// 今回の監査対象は ticket_type が 1〜4、かつ cancelled ではないチケットに限定する。
tickets = tickets.filter(
  (ticket) =>
    targetTicketTypes.has(ticket.ticket_type) && ticket.status !== 'cancelled',
);
if (since) {
  tickets = tickets.filter((ticket) => ticket.created_at >= since);
}

const userIds = [...new Set(tickets.map((ticket) => ticket.user_id))];
const users = new Map<string, UserRow>();
// PostgREST の GET URL が長くなりすぎないよう、IN 条件は小分けにする。
for (const ids of chunk(userIds, 50)) {
  const { data, error } = await client
    .from('users')
    .select('id,affiliation')
    .in('id', ids);
  if (error) {
    throw error;
  }
  for (const row of (data ?? []) as UserRow[]) {
    users.set(row.id, row);
  }
}

const classTickets = new Map<string, ClassTicketRow>();
const gymTickets = new Map<string, GymTicketRow>();
for (const ids of chunk(
  tickets.map((ticket) => ticket.id),
  50,
)) {
  const [
    { data: classes, error: classError },
    { data: gyms, error: gymError },
  ] = await Promise.all([
    client.from('class_tickets').select('id,class_id,round_id').in('id', ids),
    client.from('gym_tickets').select('id,performance_id').in('id', ids),
  ]);
  if (classError) {
    throw classError;
  }
  if (gymError) {
    throw gymError;
  }
  for (const row of (classes ?? []) as ClassTicketRow[]) {
    classTickets.set(row.id, row);
  }
  for (const row of (gyms ?? []) as GymTicketRow[]) {
    gymTickets.set(row.id, row);
  }
}

const mismatches: unknown[] = [];
for (const ticket of tickets) {
  const decoded = await decodeTicketCode(ticket.code);
  const user = users.get(ticket.user_id);
  const classTicket = classTickets.get(ticket.id);
  const gymTicket = gymTickets.get(ticket.id);

  if (!decoded) {
    mismatches.push({ ticket, issue: 'code_decode_failed' });
    continue;
  }

  const relationshipMismatch = decoded.relationship !== ticket.relationship;
  const affiliationMismatch =
    user?.affiliation !== null &&
    user?.affiliation !== undefined &&
    decoded.affiliation !== user.affiliation;
  const performanceMismatch = classTicket
    ? decoded.performance !== classTicket.class_id ||
      decoded.schedule !== classTicket.round_id
    : gymTicket
      ? decoded.performance !== gymTicket.performance_id ||
        decoded.schedule !== 0
      : false;
  const typeMismatch = decoded.type !== ticket.ticket_type;

  if (
    relationshipMismatch ||
    affiliationMismatch ||
    performanceMismatch ||
    typeMismatch
  ) {
    mismatches.push({
      ticketId: ticket.id,
      code: ticket.code,
      status: ticket.status,
      createdAt: ticket.created_at,
      userId: ticket.user_id,
      db: {
        ticketType: ticket.ticket_type,
        relationship: ticket.relationship,
        affiliation: user?.affiliation ?? null,
        class: classTicket ?? null,
        gym: gymTicket ?? null,
      },
      decoded,
      mismatch: {
        relationshipMismatch,
        affiliationMismatch,
        performanceMismatch,
        typeMismatch,
      },
    });
  }
}

const summary = {
  scanned: tickets.length,
  mismatches: mismatches.length,
  relationshipMismatches: mismatches.filter(
    (row) =>
      (row as { mismatch?: { relationshipMismatch?: boolean } }).mismatch
        ?.relationshipMismatch,
  ).length,
  affiliationMismatches: mismatches.filter(
    (row) =>
      (row as { mismatch?: { affiliationMismatch?: boolean } }).mismatch
        ?.affiliationMismatch,
  ).length,
};

// eslint-disable-next-line no-console
console.log(JSON.stringify({ summary, results: mismatches }, null, 2));

if (args.has('--fail-on-mismatch') && mismatches.length > 0) {
  Deno.exit(2);
}
