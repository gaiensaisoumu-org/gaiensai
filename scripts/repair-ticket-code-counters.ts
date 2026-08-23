import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { decodeTicketCode } from '../supabase/functions/_shared/decodeTicketCode.ts';

type TicketRow = { id: string; code: string; ticket_type: number };
type CounterRow = { prefix: string; last_value: number };

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

const pad = (value: number, length: number): string =>
  String(value).padStart(length, '0');

const toBase58 = (value: bigint, alphabet: string): string => {
  if (value === 0n) {
    return alphabet[0];
  }
  let encoded = '';
  let remaining = value;
  while (remaining > 0n) {
    encoded = alphabet[Number(remaining % 58n)] + encoded;
    remaining /= 58n;
  }
  return encoded.padStart(8, alphabet[0]);
};

await loadDotEnv();

const alphabet = env('BASE58_ALPHABET', 'VITE_BASE58_ALPHABET');
if (alphabet.length !== 58 || new Set(alphabet).size !== 58) {
  throw new Error('BASE58_ALPHABET must contain 58 unique characters');
}

const client = createClient(
  env('SUPABASE_URL', 'VITE_SUPABASE_URL'),
  env('SUPABASE_SERVICE_ROLE_KEY', 'FOR_ISSUE_TICKETS_SUPABASE_SECRET_KEY'),
);
const apply = Deno.args.includes('--apply');
const tickets = (
  await fetchAll<TicketRow>(client, 'tickets', 'id,code,ticket_type')
).filter((ticket) => TARGET_TICKET_TYPES.has(ticket.ticket_type));
const counters = new Map(
  (
    await fetchAll<CounterRow>(
      client,
      'ticket_code_counters',
      'prefix,last_value',
    )
  ).map((counter) => [counter.prefix, Number(counter.last_value)]),
);

const requiredLastValues = new Map<string, number>();
const undecodableTicketIds: string[] = [];
for (const ticket of tickets) {
  const decoded = await decodeTicketCode(ticket.code);
  if (!decoded) {
    undecodableTicketIds.push(ticket.id);
    continue;
  }

  const digits = `${pad(decoded.affiliation, 5)}${pad(decoded.type, 1)}${pad(decoded.relationship, 1)}${pad(decoded.performance, 2)}${pad(decoded.schedule, 2)}${pad(decoded.year, 2)}`;
  const prefix = toBase58(BigInt(digits), alphabet);
  requiredLastValues.set(
    prefix,
    Math.max(requiredLastValues.get(prefix) ?? 0, decoded.serial),
  );
}

const repairs = [...requiredLastValues]
  .map(([prefix, requiredLastValue]) => ({
    prefix,
    currentLastValue: counters.get(prefix) ?? 0,
    requiredLastValue,
  }))
  .filter((repair) => repair.currentLastValue < repair.requiredLastValue);

if (apply) {
  for (const repair of repairs) {
    const { error } = await client.rpc(
      'advance_ticket_code_counter_to_at_least',
      {
        p_prefix: repair.prefix,
        p_last_value: repair.requiredLastValue,
      },
    );
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
      scannedTickets: tickets.length,
      undecodableTicketIds,
      repairedCounterCount: repairs.length,
      repairs,
    },
    null,
    2,
  ),
);
