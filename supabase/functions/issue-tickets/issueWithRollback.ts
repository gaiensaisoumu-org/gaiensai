/* eslint-disable no-console */
import type { TicketData } from '../_shared/ticketDataType.ts';
import HttpError from '../_shared/HttpError.ts';

type RpcError = { message: string } | null;
type RpcResult = { data: unknown; error: RpcError };

export type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
};

export type IssueWithRollbackInput = {
  adminClient: RpcClient;
  userId: string;
  issueCount: number;
  issueMode: 'class' | 'gym' | 'admission' | 'rehearsal';
  ticketTypeId: number;
  relationshipId: number;
  performanceId: number;
  scheduleId: number;
  affiliation: number;
  issuedYear: number;
  basePrefix: string;
  endSerial: number;
  personCount?: number;
  encodingRelationshipId?: number | ((index: number) => number);
  generateCode: (ticketData: TicketData) => Promise<string>;
  signTicketCode: (code: string) => Promise<string>;
};

export const issueWithRollback = async ({
  adminClient,
  userId,
  issueCount,
  issueMode,
  ticketTypeId,
  relationshipId,
  performanceId,
  scheduleId,
  affiliation,
  issuedYear,
  basePrefix,
  endSerial,
  personCount = 1,
  encodingRelationshipId,
  generateCode,
  signTicketCode,
}: IssueWithRollbackInput): Promise<
  Array<{ code: string; signature: string }>
> => {
  const startSerial = endSerial - issueCount + 1;
  let shouldRollbackCounter = true;

  try {
    const codes = await Promise.all(
      Array.from({ length: issueCount }, (_, i) => {
        const serial = startSerial + i;
        const encRel =
          typeof encodingRelationshipId === 'function'
            ? encodingRelationshipId(i)
            : (encodingRelationshipId ?? relationshipId);
        const ticketData: TicketData = {
          affiliation,
          relationship: encRel,
          type: ticketTypeId,
          performance: performanceId,
          schedule: scheduleId,
          year: issuedYear,
          serial,
        };
        return generateCode(ticketData);
      }),
    );

    const signatures = await Promise.all(
      codes.map((code) => signTicketCode(code)),
    );

    const issueRpcName =
      issueMode === 'gym'
        ? 'issue_gym_tickets_with_codes'
        : issueMode === 'rehearsal'
          ? 'issue_rehearsal_ticket_with_code'
          : 'issue_class_tickets_with_codes';

    const args =
      issueMode === 'rehearsal'
        ? {
            p_user_id: userId,
            p_ticket_type_id: ticketTypeId,
            p_relationship_id: relationshipId,
            p_class_id: performanceId,
            p_round_id: scheduleId,
            p_issue_count: issueCount,
            p_codes: codes,
            p_signatures: signatures,
          }
        : {
            p_user_id: userId,
            p_ticket_type_id: ticketTypeId,
            p_relationship_id: relationshipId,
            p_performance_id: performanceId,
            p_schedule_id: scheduleId,
            p_issue_count: issueCount,
            p_codes: codes,
            p_signatures: signatures,
            p_person_count: personCount,
          };
    const { data: issuedTickets, error: issueError } = await adminClient.rpc(
      issueRpcName,
      args,
    );

    if (issueError) {
      console.log('発券に失敗しました', {
        issueRpcName,
        p_user_id: userId,
        p_ticket_type_id: ticketTypeId,
        p_relationship_id: relationshipId,
        p_performance_id: performanceId,
        p_schedule_id: scheduleId,
        p_issue_count: issueCount,
        p_codes: codes,
        p_signatures: signatures,
        p_person_count: personCount,
      });
      throw new HttpError(409, issueError.message);
    }

    shouldRollbackCounter = false;
    return (issuedTickets as Array<{ code: string; signature: string }>) ?? [];
  } finally {
    if (shouldRollbackCounter) {
      const { data: rollbackApplied, error: rollbackError } =
        await adminClient.rpc('rollback_ticket_code_counter', {
          p_prefix: basePrefix,
          p_decrement: issueCount,
          p_expected_last_value: endSerial,
        });

      if (rollbackError) {
        console.error('Failed to rollback ticket code counter', {
          userId,
          prefix: basePrefix,
          issueCount,
          endSerial,
          rollbackError,
        });
      } else if (rollbackApplied !== true) {
        console.error('Counter rollback was skipped because state changed', {
          userId,
          prefix: basePrefix,
          issueCount,
          endSerial,
        });
      }
    }
  }
};
