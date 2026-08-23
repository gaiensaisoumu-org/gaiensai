import { useEffect, useState } from 'preact/hooks';
import { applyDecodedSerials } from './decodeTicketSerial';

export const useDecodedSerialTickets = <T extends { code: string }>(
  sourceTickets: T[],
): Array<T & { serial?: number }> => {
  const [tickets, setTickets] =
    useState<Array<T & { serial?: number }>>(sourceTickets);

  useEffect(() => {
    let cancelled = false;
    setTickets(sourceTickets);

    const loadSerials = async () => {
      const decoded = await applyDecodedSerials(sourceTickets);
      if (!cancelled) {
        setTickets(decoded);
      }
    };

    void loadSerials();

    return () => {
      cancelled = true;
    };
  }, [sourceTickets]);

  return tickets;
};
