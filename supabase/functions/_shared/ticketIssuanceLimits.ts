export type TicketTarget = { type: 'class' | 'gym'; name: string };

export type TicketLimitInput = {
  ownClass: string;
  ownClubs: string[];
  target: TicketTarget;
  ownClassLimit: number;
  otherClassLimit: number;
  ownClubLimits: Record<string, number>;
  otherClubLimit: number;
  otherTotalLimit: number;
  classCounts: Record<string, number>;
  clubCounts: Record<string, number>;
  issueCount: number;
  isDayTicket?: boolean;
  isAdminIssue?: boolean;
};

export const canIssueWithinStudentLimits = (input: TicketLimitInput): boolean => {
  if (input.isDayTicket || input.isAdminIssue) return true;
  const isOwn = input.target.type === 'class'
    ? input.target.name === input.ownClass
    : input.ownClubs.includes(input.target.name);
  const individualLimit = input.target.type === 'class'
    ? (isOwn ? input.ownClassLimit : input.otherClassLimit)
    : (isOwn
      ? (input.ownClubLimits[input.target.name] ?? input.otherClubLimit)
      : input.otherClubLimit);
  const current = input.target.type === 'class'
    ? (input.classCounts[input.target.name] ?? 0)
    : (input.clubCounts[input.target.name] ?? 0);
  if (current + input.issueCount > individualLimit) return false;
  if (!isOwn) {
    const otherTotal = Object.entries(input.classCounts)
      .filter(([name]) => name !== input.ownClass)
      .reduce((sum, [, count]) => sum + count, 0) +
      Object.entries(input.clubCounts)
        .filter(([name]) => !input.ownClubs.includes(name))
        .reduce((sum, [, count]) => sum + count, 0);
    if (otherTotal + input.issueCount > input.otherTotalLimit) return false;
  }
  return true;
};
