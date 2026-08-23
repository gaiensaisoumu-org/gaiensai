import { supabase } from '../../../lib/supabase';

export const JUNIOR_ENTRY_ONLY_TICKET_TYPE_ID = 7;
const ISSUE_POLL_MAX_RETRIES = 20;
const ISSUE_POLL_INTERVAL_MS = 300;

export const waitForJuniorEntryOnlyTicketIssued =
  async (): Promise<boolean> => {
    for (let i = 0; i < ISSUE_POLL_MAX_RETRIES; i++) {
      const { data, error } = await supabase.rpc('get_junior_my_page');
      if (!error) {
        const tickets = (
          data as {
            tickets?: Array<{ ticket_type?: number | null }>;
          } | null
        )?.tickets;
        if (
          tickets?.some(
            (ticket) =>
              Number(ticket.ticket_type) === JUNIOR_ENTRY_ONLY_TICKET_TYPE_ID,
          )
        ) {
          return true;
        }
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, ISSUE_POLL_INTERVAL_MS);
      });
    }

    return false;
  };
