import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { decodeTicketCode } from '../supabase/functions/_shared/decodeTicketCode.ts';

type TicketRow = {
  id: string;
  code: string;
  ticket_type: number;
  relationship: number;
  status: string;
  user_id: string;
};
type UserRow = { id: string; affiliation: number | null; role: string | null };
type ClassTicketRow = { id: string; class_id: number; round_id: number };
type GymTicketRow = { id: string; performance_id: number };

const TARGET_TICKET_TYPES = new Set([1, 2, 3, 4]);

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
): Promise<T[]> => {
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

await loadDotEnv();

const client = createClient(
  env('SUPABASE_URL', 'VITE_SUPABASE_URL'),
  env('SUPABASE_SERVICE_ROLE_KEY', 'FOR_ISSUE_TICKETS_SUPABASE_SECRET_KEY'),
);
const apply = Deno.args.includes('--apply');

const tickets = (await fetchAll<TicketRow>(
  client,
  'tickets',
  'id,code,ticket_type,relationship,status,user_id',
)).filter(
  (ticket) =>
    TARGET_TICKET_TYPES.has(ticket.ticket_type) && ticket.status !== 'cancelled',
);

const userIds = [...new Set(tickets.map((ticket) => ticket.user_id))];
const users = new Map<string, UserRow>();
for (const ids of chunk(userIds, 50)) {
  const { data, error } = await client
    .from('users')
    .select('id,affiliation,role')
    .in('id', ids);
  if (error) {
    throw error;
  }
  for (const user of (data ?? []) as UserRow[]) {
    users.set(user.id, user);
  }
}

const ticketIds = tickets.map((ticket) => ticket.id);
const classTickets = new Map<string, ClassTicketRow>();
const gymTickets = new Map<string, GymTicketRow>();
for (const ids of chunk(ticketIds, 50)) {
  const [classesResult, gymsResult] = await Promise.all([
    client.from('class_tickets').select('id,class_id,round_id').in('id', ids),
    client.from('gym_tickets').select('id,performance_id').in('id', ids),
  ]);
  if (classesResult.error) {
    throw classesResult.error;
  }
  if (gymsResult.error) {
    throw gymsResult.error;
  }
  for (const row of (classesResult.data ?? []) as ClassTicketRow[]) {
    classTickets.set(row.id, row);
  }
  for (const row of (gymsResult.data ?? []) as GymTicketRow[]) {
    gymTickets.set(row.id, row);
  }
}

const candidates: Array<{
  id: string;
  code: string;
  userId: string;
  currentRelationship: number;
  decodedRelationship: number;
}> = [];

for (const ticket of tickets) {
  const decoded = await decodeTicketCode(ticket.code);
  const user = users.get(ticket.user_id);
  const classTicket = classTickets.get(ticket.id);
  const gymTicket = gymTickets.get(ticket.id);
  if (!decoded || user?.role !== 'student') {
    continue;
  }

  const affiliationMatches = user.affiliation === decoded.affiliation;
  const typeMatches = ticket.ticket_type === decoded.type;
  const performanceMatches = classTicket
    ? classTicket.class_id === decoded.performance &&
      classTicket.round_id === decoded.schedule
    : gymTicket
      ? gymTicket.performance_id === decoded.performance && decoded.schedule === 0
      : false;

  if (
    affiliationMatches &&
    typeMatches &&
    performanceMatches &&
    ticket.relationship !== decoded.relationship
  ) {
    candidates.push({
      id: ticket.id,
      code: ticket.code,
      userId: ticket.user_id,
      currentRelationship: ticket.relationship,
      decodedRelationship: decoded.relationship,
    });
  }
}

if (apply) {
  for (const candidate of candidates) {
    const { error } = await client
      .from('tickets')
      .update({ relationship: candidate.decodedRelationship })
      .eq('id', candidate.id)
      .neq('status', 'cancelled');
    if (error) {
      throw error;
    }
  }
}

// eslint-disable-next-line no-console
console.log(
  JSON.stringify(
    {
      mode: apply ? 'applied' : 'dry-run',
      candidateCount: candidates.length,
      candidates,
    },
    null,
    2,
  ),
);
