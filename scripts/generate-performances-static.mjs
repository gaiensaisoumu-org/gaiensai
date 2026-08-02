/* eslint-disable no-undef */
/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const rootDir = process.cwd();
const outputPath = resolve(rootDir, 'src/generated/performances-static.json');

const parseEnvText = (text) => {
  const parsed = {};

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim();
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
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
};

const readEnvFile = (filePath) => {
  if (!existsSync(filePath)) {
    return {};
  }
  return parseEnvText(readFileSync(filePath, 'utf8'));
};

const env = {
  ...readEnvFile(resolve(rootDir, '.env')),
  ...readEnvFile(resolve(rootDir, '.env.local')),
  ...process.env,
};

if (!env.VITE_SUPABASE_URL) {
  console.warn("Skipping static generation (no Supabase env)");
  process.exit(0);
}

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey =
  env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY (or VITE_SUPABASE_ANON_KEY) are required.',
  );
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const buildSnapshot = async () => {
  const [
    { data: performanceData, error: performanceError },
    { data: gymPerformanceData, error: gymPerformanceError },
    { data: scheduleData, error: scheduleError },
    { data: ticketTypeData, error: ticketTypeError },
    { data: relationshipData, error: relationshipError },
    { data: configData, error: configError },
  ] = await Promise.all([
    supabase
      .from('class_performances')
      .select(
        'id, year, class_name, title, description, created_at, junior_capacity, total_capacity, is_accepting, image_path',
      )
      .order('id', { ascending: true }),
    supabase
      .from('gym_performances')
      .select(
        'id, group_name, round_name, start_at, end_at, capacity, junior_capacity, year, is_accepting, description, image_path',
      )
      .order('group_name', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('performances_schedule')
      .select('id, round_name, start_at')
      .order('id', { ascending: true }),
    supabase
      .from('ticket_types')
      .select('id, name, type')
      .order('id', { ascending: true }),
    supabase.from('relationships').select('id, name').order('id', { ascending: true }),
    supabase
      .from('configs')
      .select('show_length')
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (
    performanceError ||
    gymPerformanceError ||
    scheduleError ||
    ticketTypeError ||
    relationshipError ||
    configError
  ) {
    throw new Error('Failed to fetch snapshot data from Supabase.');
  }

  const performances = performanceData ?? [];
  const gymPerformances = gymPerformanceData ?? [];
  const schedules = scheduleData ?? [];
  const ticketTypes = ticketTypeData ?? [];
  const relationships = relationshipData ?? [];
  const showLengthMinutes = Number(configData?.show_length ?? 0);

  return {
    generatedAt: new Date().toISOString(),
    performances,
    gymPerformances,
    schedules,
    ticketTypes,
    relationships,
    showLengthMinutes,
  };
};

try {
  const snapshot = await buildSnapshot();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`Generated ${outputPath}`);
} catch (error) {
  if (existsSync(outputPath)) {
    console.warn(
      `[warn] Failed to refresh ${outputPath}. Existing snapshot is kept.`,
    );
    console.warn(error);
    process.exit(0);
  }

  throw error;
}
