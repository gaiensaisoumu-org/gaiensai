import { decodeTicketCodeWithEnv } from './ticketCodeDecode';

export const decodeTicketSerialFromCode = async (
  code: string,
): Promise<number | undefined> => {
  try {
    const decoded = await decodeTicketCodeWithEnv(code);
    return typeof decoded?.serial === 'number' ? decoded.serial : undefined;
  } catch {
    return undefined;
  }
};

export const applyDecodedSerials = async <T extends { code: string }>(
  tickets: T[],
): Promise<Array<T & { serial?: number; decodedRelationshipId?: number }>> =>
  Promise.all(
    tickets.map(async (ticket) => {
      try {
        const decoded = await decodeTicketCodeWithEnv(ticket.code);
        return {
          ...ticket,
          serial:
            typeof decoded?.serial === 'number' ? decoded.serial : undefined,
          decodedRelationshipId:
            typeof decoded?.relationship === 'number'
              ? decoded.relationship
              : undefined,
        };
      } catch {
        return { ...ticket };
      }
    }),
  );
