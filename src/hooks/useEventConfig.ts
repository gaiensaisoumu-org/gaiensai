import { useEffect, useState } from 'preact/hooks';
import type { EventConfig } from '../types/types';

const STORAGE_KEY = 'event_config';

const defaultConfig: EventConfig = {
  site_url: 'gaiensai.com',
  year: 2025,
  name: '外苑祭',
  school: '東京都立青山高校',
  operating_organization: '外苑祭総務',
  catchCopy: '熱狂が、幕を開ける。',
  meta_description:
    '東京都立青山高校外苑祭公式サイト。このサイトでは、外苑祭について知り、公演一覧やタイムスケジュールを見ることができます。また、もらった招待券を表示したり、青高生は招待券を発行することもできます。',
  date: [],
  date_length: 0,
  grade_number: 3,
  class_number: 7,
  max_attendance_number: 42,
  // performances_per_day: 4,
  last_update: null,
};

const parseScalar = (value: string): string | number => {
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  return value;
};

const parseConfigYaml = (yamlText: string): Partial<EventConfig> => {
  const lines = yamlText.split('\n');
  const parsed: Record<string, string | number | string[]> = {};
  let currentArrayKey: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const arrayItemMatch = line.match(/^\s*-\s*(.+)$/);
    if (arrayItemMatch && currentArrayKey) {
      const nextValue = arrayItemMatch[1].trim();
      const current = parsed[currentArrayKey];
      if (Array.isArray(current)) {
        current.push(nextValue);
      }
      continue;
    }

    const keyValueMatch = line.match(/^([a-zA-Z_][\w]*)\s*:\s*(.*)$/);
    if (!keyValueMatch) {
      currentArrayKey = null;
      continue;
    }

    const key = keyValueMatch[1];
    const value = keyValueMatch[2].trim();

    if (value === '') {
      parsed[key] = [];
      currentArrayKey = key;
      continue;
    }

    currentArrayKey = null;
    parsed[key] = parseScalar(value);
  }

  const date = Array.isArray(parsed.date) ? parsed.date : [];

  return {
    site_url:
      typeof parsed.site_url === 'string'
        ? parsed.site_url
        : defaultConfig.site_url,
    year: typeof parsed.year === 'number' ? parsed.year : defaultConfig.year,
    name: typeof parsed.name === 'string' ? parsed.name : defaultConfig.name,
    school:
      typeof parsed.school === 'string' ? parsed.school : defaultConfig.school,
    operating_organization:
      typeof parsed.operating_organization === 'string'
        ? parsed.operating_organization
        : defaultConfig.operating_organization,
    catchCopy:
      typeof parsed.catchCopy === 'string'
        ? parsed.catchCopy
        : defaultConfig.catchCopy,
    meta_description:
      typeof parsed.meta_description === 'string'
        ? parsed.meta_description
        : defaultConfig.meta_description,
    date,
    date_length: date.length,
    grade_number:
      typeof parsed.grade_number === 'number'
        ? parsed.grade_number
        : defaultConfig.grade_number,
    class_number:
      typeof parsed.class_number === 'number'
        ? parsed.class_number
        : defaultConfig.class_number,
    max_attendance_number:
      typeof parsed.max_attendance_number === 'number'
        ? parsed.max_attendance_number
        : defaultConfig.max_attendance_number,
    // performances_per_day:
    //   typeof parsed.performances_per_day === 'number'
    //     ? parsed.performances_per_day
    //     : defaultConfig.performances_per_day,
    last_update:
      typeof parsed.last_update === 'string'
        ? parsed.last_update
        : defaultConfig.last_update,
  };
};

const loadConfigFromStorage = (): EventConfig => {
  if (typeof window === 'undefined') {
    return defaultConfig;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return defaultConfig;
    }

    const parsed = JSON.parse(stored) as Partial<EventConfig>;
    return {
      ...defaultConfig,
      ...parsed,
      date: Array.isArray(parsed.date) ? parsed.date : defaultConfig.date,
      date_length:
        typeof parsed.date_length === 'number'
          ? parsed.date_length
          : Array.isArray(parsed.date)
            ? parsed.date.length
            : defaultConfig.date_length,
    };
  } catch {
    return defaultConfig;
  }
};

export const useEventConfig = () => {
  const [config, setConfig] = useState<EventConfig>(loadConfigFromStorage);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/config.yaml', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('failed_to_fetch_config');
        }

        const yamlText = await response.text();
        const normalized = {
          ...defaultConfig,
          ...parseConfigYaml(yamlText),
        } as EventConfig;

        setConfig(normalized);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      } catch {
        // keep storage/default value
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  // const maxPerformances = useMemo(
  //   () => config.date_length * config.performances_per_day,
  //   [config.date_length, config.performances_per_day],
  // );

  return { config, loading/*, maxPerformances*/ };
};
