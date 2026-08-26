export const ISSUE_RESULT_STORAGE_KEY = 'students_issue_result';
export const JUNIOR_ISSUE_RESULT_STORAGE_KEY = 'junior_issue_result';
export const DAY_TICKET_RESULT_STORAGE_KEY = 'day_ticket_issue_result';

export type IssuedTicketResult = {
  code: string;
  signature: string;
};

export type IssueResultPayload = {
  performanceName: string;
  performanceTitle: string;
  scheduleName: string;
  scheduleDate: string;
  scheduleTime: string;
  scheduleEndTime: string;
  isOfficialRehearsal?: boolean;
  ticketTypeLabel: string;
  relationshipName: string;
  relationshipId: number;
  issuedTickets: IssuedTicketResult[];
};
