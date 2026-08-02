import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  readTicketDisplayCache,
  writeTicketDisplayCache,
  listTicketDisplayCache,
  markTicketDisplayCacheCancelled,
  touchTicketDisplayCacheOpenedAt,
  clearTicketDisplayCache,
  clearTicketHistoryCaches,
  clearAllUserCaches,
} from './ticketDisplayCache';

describe('ticketDisplayCache', () => {
  const sample = { code: 'ABC', foo: 'bar' };

  beforeEach(() => {
    // clear localStorage before each test
    localStorage.clear();
  });

  it('can write and read an entry', () => {
    writeTicketDisplayCache(sample.code, sample);
    expect(readTicketDisplayCache<typeof sample>(sample.code)).toEqual({
      ...sample,
      status: 'unknown',
      lastOpenedAt: expect.any(Number),
    });
  });

  it('list returns entries in most-recent-open-first order', () => {
    // write two entries with explicit lastOpenedAt timestamps to ensure ordering
    const now = Date.now();
    localStorage.setItem(
      'ticket-display-cache:v1:A',
      JSON.stringify({
        ticket: { code: 'A' },
        cachedAt: now,
        lastOpenedAt: now,
      }),
    );
    localStorage.setItem(
      'ticket-display-cache:v1:B',
      JSON.stringify({
        ticket: { code: 'B' },
        cachedAt: now + 1000,
        lastOpenedAt: now + 1000,
      }),
    );
    const list = listTicketDisplayCache<{ code: string }>();
    expect(list.map((t) => t.code)).toEqual(['B', 'A']);
    expect(
      list.every(
        (ticket) =>
          (ticket as { status?: string }).status === 'unknown',
      ),
    ).toBe(true);
  });

  it('markTicketDisplayCacheCancelled sets status field', () => {
    // sample has extra fields, cast to unknown to satisfy generic
    writeTicketDisplayCache(sample.code, sample as unknown as { code: string });
    const before = readTicketDisplayCache<{ status?: string }>(sample.code);
    expect(before?.status).toBe('unknown');
    markTicketDisplayCacheCancelled(sample.code);
    const after = readTicketDisplayCache<{ status?: string }>(sample.code);
    expect(after?.status).toBe('cancelled');
  });

  it('touchTicketDisplayCacheOpenedAt updates lastOpenedAt', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    writeTicketDisplayCache(sample.code, sample);
    const before = readTicketDisplayCache<{ lastOpenedAt?: number }>(
      sample.code,
    );
    const beforeOpenedAt = before?.lastOpenedAt ?? 0;
    vi.spyOn(Date, 'now').mockReturnValue(2000);
    touchTicketDisplayCacheOpenedAt(sample.code);
    const after = readTicketDisplayCache<{ lastOpenedAt?: number }>(
      sample.code,
    );
    expect(after?.lastOpenedAt).toBe(2000);
    expect((after?.lastOpenedAt ?? 0) > beforeOpenedAt).toBe(true);
    vi.restoreAllMocks();
  });

  it('clears ticket display history without removing other local storage', () => {
    writeTicketDisplayCache(sample.code, sample);
    localStorage.setItem('unrelated-setting', 'keep');

    clearTicketDisplayCache();

    expect(listTicketDisplayCache()).toEqual([]);
    expect(localStorage.getItem('unrelated-setting')).toBe('keep');
  });

  it('clears ticket list caches for students and junior users', () => {
    writeTicketDisplayCache(sample.code, sample);
    localStorage.setItem('students_ticket_cards_cache:v1:student-1', '{}');
    localStorage.setItem('junior_ticket_cards_cache:v1:junior-1', '{}');
    localStorage.setItem('unrelated-setting', 'keep');

    clearTicketHistoryCaches();

    expect(listTicketDisplayCache()).toEqual([]);
    expect(localStorage.getItem('students_ticket_cards_cache:v1:student-1')).toBeNull();
    expect(localStorage.getItem('junior_ticket_cards_cache:v1:junior-1')).toBeNull();
    expect(localStorage.getItem('unrelated-setting')).toBe('keep');
  });

  it('clears all local storage except authentication sessions', () => {
    localStorage.setItem('students_profile_cache:v1:student-1', '{}');
    localStorage.setItem('junior_profile_cache:v1:junior-1', '{}');
    localStorage.setItem('performances-table-cache:v1:general:all:all', '{}');
    localStorage.setItem('gym-performances-table-cache:v1:general:all:all', '{}');
    localStorage.setItem('event_config', '{}');
    localStorage.setItem('unrelated-setting', 'remove');
    localStorage.setItem('admin_control_panel_session_v2', 'keep');
    localStorage.setItem('sb-project-auth-token', 'keep');

    clearAllUserCaches();

    expect(localStorage.getItem('students_profile_cache:v1:student-1')).toBeNull();
    expect(localStorage.getItem('junior_profile_cache:v1:junior-1')).toBeNull();
    expect(
      localStorage.getItem('performances-table-cache:v1:general:all:all'),
    ).toBeNull();
    expect(
      localStorage.getItem('gym-performances-table-cache:v1:general:all:all'),
    ).toBeNull();
    expect(localStorage.getItem('event_config')).toBeNull();
    expect(localStorage.getItem('unrelated-setting')).toBeNull();
    expect(localStorage.getItem('admin_control_panel_session_v2')).toBe('keep');
    expect(localStorage.getItem('sb-project-auth-token')).toBe('keep');
  });
});
