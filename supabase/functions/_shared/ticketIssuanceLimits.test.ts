import { canIssueWithinStudentLimits } from './ticketIssuanceLimits.ts';

const base = {
  ownClass: '2-1', ownClubs: [], ownClassLimit: 2, otherClassLimit: 2,
  ownClubLimits: {}, otherClubLimit: 2, otherTotalLimit: 4,
  classCounts: {}, clubCounts: {}, issueCount: 1,
};

Deno.test('club 0: own/other class, other club, and aggregate limits', () => {
  if (!canIssueWithinStudentLimits({ ...base, target: { type: 'class', name: '2-1' } })) throw new Error('own class should pass');
  if (!canIssueWithinStudentLimits({ ...base, target: { type: 'class', name: '2-2' } })) throw new Error('other class should pass');
  if (!canIssueWithinStudentLimits({ ...base, target: { type: 'gym', name: 'band' } })) throw new Error('other club should pass');
  if (canIssueWithinStudentLimits({ ...base, target: { type: 'gym', name: 'band' }, classCounts: { '2-2': 2 }, clubCounts: { choir: 2 } })) throw new Error('aggregate limit should fail');
});

Deno.test('club 1: own club and other club limits', () => {
  const input = { ...base, ownClubs: ['band'], ownClubLimits: { band: 2 }, target: { type: 'gym' as const, name: 'band' } };
  if (!canIssueWithinStudentLimits(input)) throw new Error('own club should pass');
  if (!canIssueWithinStudentLimits({ ...input, target: { type: 'gym', name: 'choir' } })) throw new Error('other club should pass');
});

Deno.test('club 2: either own club can be exhausted independently', () => {
  const input = { ...base, ownClubs: ['band', 'choir'], ownClubLimits: { band: 1, choir: 1 }, target: { type: 'gym' as const, name: 'band' }, clubCounts: { band: 1 } };
  if (canIssueWithinStudentLimits(input)) throw new Error('exhausted own club should fail');
  if (!canIssueWithinStudentLimits({ ...input, target: { type: 'gym', name: 'choir' } })) throw new Error('other own club should remain available');
});

Deno.test('day tickets and admin issuance bypass limits', () => {
  const exhausted = { ...base, target: { type: 'gym' as const, name: 'band' }, classCounts: { '2-2': 2 }, clubCounts: { choir: 2 } };
  if (!canIssueWithinStudentLimits({ ...exhausted, isDayTicket: true })) throw new Error('day ticket should bypass');
  if (!canIssueWithinStudentLimits({ ...exhausted, isAdminIssue: true })) throw new Error('admin issue should bypass');
});
