import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('../../../lib/supabase', () => ({
  supabase: { rpc: rpcMock },
}));

import { waitForJuniorEntryOnlyTicketIssued } from './juniorTicketWait';

describe('waitForJuniorEntryOnlyTicketIssued', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('resolves when the my-page response contains an entry-only ticket', async () => {
    rpcMock.mockResolvedValue({
      data: { tickets: [{ ticket_type: 7 }] },
      error: null,
    });

    await expect(waitForJuniorEntryOnlyTicketIssued()).resolves.toBe(true);
    expect(rpcMock).toHaveBeenCalledOnce();
    expect(rpcMock).toHaveBeenCalledWith('get_junior_my_page');
  });
});
