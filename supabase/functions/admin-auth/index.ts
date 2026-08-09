/* eslint-disable no-console */

import '@supabase/functions-js/edge-runtime.d.ts';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { compare, hash } from 'bcryptjs';

import { getCorsHeaders } from '@shared/cors.ts';
import { getEnv } from '@shared/getEnv.ts';
import HttpError from '@shared/HttpError.ts';
import { triggerCloudflarePagesDeploy } from '@shared/triggerCloudflarePagesDeploy.ts';
import {
  generateManualCode,
  generateTicketCode,
  signCode,
} from '@shared/generateTicketCode.ts';
import { YEAR_BITS, SERIAL_BITS } from '@shared/ticketDataType.ts';
import {
  issueWithRollback,
  type RpcClient,
} from '../issue-tickets/issueWithRollback.ts';

const ADMIN_CONTROL_PANEL_SESSION_DURATION_MS = 1000 * 60 * 60 * 8;
const ADMIN_AUTH_MAX_FAILED_ATTEMPTS = 5;
const ADMIN_AUTH_LOCK_DURATION_MS = 1000 * 60 * 10; // 10分
const ADMIN_LIST_PAGE_SIZE = 1000;

/** PostgREST の既定上限を越える管理画面用一覧を、ページ単位で取得する。 */
const fetchAllRows = async <T>(
  fetchPage: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: unknown;
  }>,
): Promise<T[]> => {
  const rows: T[] = [];
  for (let from = 0; ; from += ADMIN_LIST_PAGE_SIZE) {
    const { data, error } = await fetchPage(
      from,
      from + ADMIN_LIST_PAGE_SIZE - 1,
    );
    if (error) {
      throw error;
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < ADMIN_LIST_PAGE_SIZE) {
      return rows;
    }
  }
};

type AdminAuthRequest = {
  action?: unknown;
  password?: unknown;
  currentPassword?: unknown;
  newPassword?: unknown;
  eventYear?: unknown;
  showLength?: unknown;
  maxTicketsPerOtherClassUser?: unknown;
  maxTicketsPerOtherPerformanceUser?: unknown;
  classTicketLimitsById?: unknown;
  maxTicketsPerOtherClubUser?: unknown;
  gymTicketLimitsByClub?: unknown;
  maxTicketsPerJuniorUser?: unknown;
  juniorReleaseOpen?: unknown;
  ticketIssuingEnabled?: unknown;
  activeTicketTypeIds?: unknown;
  ticketIssueModes?: unknown;
  defaultClassTotalCapacity?: unknown;
  defaultClassJuniorCapacity?: unknown;
  defaultGymCapacity?: unknown;
  defaultGymJuniorCapacity?: unknown;
  table?: unknown;
  recordId?: unknown;
  column?: unknown;
  value?: unknown;
  name?: unknown;
  teachers?: unknown;
  users?: unknown;
  studentId?: unknown;
  clubs?: unknown;
  accountType?: unknown;
  userEmail?: unknown;
  juniorPassword?: unknown;
  secretCode?: unknown;
  maxAdmissionOnlyJuniorAccounts?: unknown;
  code?: unknown;
  affiliation?: unknown;
  ticketTypeId?: unknown;
  relationshipId?: unknown;
  performanceId?: unknown;
  scheduleId?: unknown;
  issueCount?: unknown;
  juniorRelationshipId?: unknown;
  organizationAdminId?: unknown;
  organizationUsername?: unknown;
  organizationPassword?: unknown;
  organizationKind?: unknown;
  organizationPerformanceId?: unknown;
  organizationAdmins?: unknown;
  className?: unknown;
  title?: unknown;
  description?: unknown;
  totalCapacity?: unknown;
  juniorCapacity?: unknown;
  isAccepting?: unknown;
  contentType?: unknown;
  base64?: unknown;
  performanceType?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  roundName?: unknown;
  isActive?: unknown;
};

type TicketIssueMode =
  | 'open'
  | 'only-own'
  | 'outside-own-self-only'
  | 'public-rehearsals'
  | 'auto'
  | 'off';

type TicketIssueModes = {
  classInvite: TicketIssueMode;
  rehearsalInvite: TicketIssueMode;
  gymInvite: TicketIssueMode;
  entryOnly: TicketIssueMode;
  sameDayClass: TicketIssueMode;
  sameDayGym: TicketIssueMode;
  juniorClass: TicketIssueMode;
  juniorGym: TicketIssueMode;
  juniorEntryOnly: TicketIssueMode;
};

type AdminAuthBody =
  | { mode: 'login'; password: string }
  | { mode: 'verifySession' }
  | { mode: 'logoutSession' }
  | { mode: 'changePassword'; currentPassword: string; newPassword: string }
  | { mode: 'getSettings' }
  | { mode: 'triggerRedeploy' }
  | { mode: 'getTeachers' }
  | { mode: 'updateTeacher'; teacherId: number; name: string }
  | { mode: 'updateAllTeachers'; teachers: { id: number; name: string }[] }
  | { mode: 'deleteAllStudentAccounts' }
  | { mode: 'deleteAccountsByType'; accountType: 'student' | 'junior' }
  | {
      mode: 'resetUserData';
      accountType: 'student' | 'junior';
      userEmail: string;
    }
  | {
      mode: 'deleteUserAccount';
      accountType: 'student' | 'junior';
      userEmail: string;
    }
  | { mode: 'deleteAllTicketsAndResetCounters' }
  | { mode: 'deleteAllFlappyLeaderboardEntries' }
  | { mode: 'getStatusDashboard' }
  | { mode: 'getTicketManagementData' }
  | { mode: 'cancelTicket'; code: string }
  | {
      mode: 'adminIssueTickets';
      affiliation: number;
      ticketTypeId: number;
      relationshipId: number;
      juniorRelationshipId: number | null;
      performanceId: number;
      scheduleId: number;
      issueCount: number;
    }
  | { mode: 'getStudentUsers' }
  | { mode: 'updateStudentClubs'; studentId: string; clubs: string[] }
  | {
      mode: 'resetUserPassword';
      studentId: string;
      newPassword: string;
    }
  | {
      mode: 'bulkCreateUsers';
      users: { id: string; password: string }[];
    }
  | {
      mode: 'updateTicketTypeSettings';
      activeTicketTypeIds: number[];
      ticketIssueModes: TicketIssueModes;
    }
  | {
      mode: 'updateSettings';
      eventYear: number;
      showLength: number;
      maxTicketsPerOtherClassUser: number;
      maxTicketsPerOtherPerformanceUser: number;
      classTicketLimitsById: Record<string, number>;
      maxTicketsPerOtherClubUser: number;
      gymTicketLimitsByClub: Record<string, number>;
      maxTicketsPerJuniorUser: number;
      maxAdmissionOnlyJuniorAccounts: number;
      juniorReleaseOpen: boolean;
      ticketIssuingEnabled: boolean;
      defaultClassTotalCapacity: number;
      defaultClassJuniorCapacity: number;
      defaultGymCapacity: number;
      defaultGymJuniorCapacity: number;
    }
  | {
      mode: 'updateAcceptingStatus';
      table: string;
      recordId: number;
      column: string;
      value: boolean | number;
    }
  | { mode: 'getJuniorPassword' }
  | { mode: 'updateJuniorPassword'; juniorPassword: string }
  | { mode: 'validateJuniorSecretCode'; secretCode: string }
  | { mode: 'getOrganizationAdmins' }
  | { mode: 'getClassPerformances' }
  | {
      mode: 'updateClassPerformance';
      id: number;
      className: string;
      title: string;
      description: string;
      totalCapacity: number;
      juniorCapacity: number;
      isAccepting: boolean;
      performanceType: 'class' | 'gym' | 'exhibition';
      startAt: string | null;
      endAt: string | null;
    }
  | {
      mode: 'updatePerformanceSchedule';
      id: number;
      roundName: string;
      startAt: string;
      isActive: boolean;
    }
  | {
      mode: 'uploadClassPerformanceImage';
      id: number;
      contentType: 'image/jpeg' | 'image/png' | 'image/webp';
      base64: string;
      performanceType: 'class' | 'gym' | 'exhibition';
    }
  | {
      mode: 'createOrganizationAdmin';
      username: string;
      password: string;
      kind: 'class' | 'gym' | 'exhibition';
      performanceId: number;
    }
  | {
      mode: 'changeOrganizationAdminPassword';
      organizationAdminId: string;
      password: string;
    }
  | { mode: 'changeOrganizationAdminUsername'; organizationAdminId: string; username: string }
  | { mode: 'deleteOrganizationAdmin'; organizationAdminId: string }
  | { mode: 'deleteAllOrganizationAdmins' }
  | { mode: 'bulkCreateOrganizationAdmins'; admins: { username: string; password: string; kind: 'class' | 'gym' | 'exhibition'; performanceId: number }[] };

type AdminConfigRow = {
  id: number;
  admin_password: string;
};

type AdminSettingsRow = {
  id: number;
  event_year: number;
  show_length: number;
  max_tickets_per_other_class_user: number;
  max_tickets_per_other_performance_user: number;
  max_tickets_per_other_club_user: number;
  gym_ticket_limits_by_club: Record<string, number>;
  max_tickets_per_junior_user: number;
  max_admission_only_junior_accounts: number;
  junior_release_open: boolean;
  is_active: boolean;
};

type AdminSessionRow = {
  id: string;
  expires_at: string;
};

type AdminRateLimitRow = {
  ip_address: string;
  failed_attempts: number;
  locked_until: string | null;
};

type TicketIssueControlsRow = {
  class_invite_mode: TicketIssueMode;
  rehearsal_invite_mode: TicketIssueMode;
  gym_invite_mode: TicketIssueMode;
  entry_only_mode: TicketIssueMode;
  same_day_class_mode: TicketIssueMode;
  same_day_gym_mode: TicketIssueMode;
  junior_class_mode: TicketIssueMode;
  junior_gym_mode: TicketIssueMode;
  junior_entry_only_mode: TicketIssueMode;
};

const ADMIN_SESSION_TOKEN_HEADER = 'x-admin-session-token';
const MAX_SESSION_TOKEN_LENGTH = 512;
const MAX_IP_ADDRESS_LENGTH = 128;
const MANAGED_TICKET_TYPE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const TICKET_ISSUE_MODE_VALUES = [
  'open',
  'only-own',
  'outside-own-self-only',
  'public-rehearsals',
  'auto',
  'off',
] as const;
const DEFAULT_TICKET_ISSUE_MODES: TicketIssueModes = {
  classInvite: 'open',
  rehearsalInvite: 'open',
  gymInvite: 'open',
  entryOnly: 'open',
  sameDayClass: 'open',
  sameDayGym: 'open',
  juniorClass: 'open',
  juniorGym: 'open',
  juniorEntryOnly: 'open',
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const hashToken = async (token: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return toHex(new Uint8Array(digest));
};

const createRawToken = (): string => {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  return `adm_${toHex(random)}`;
};

const readSessionToken = (req: Request): string | null => {
  const token = req.headers.get(ADMIN_SESSION_TOKEN_HEADER)?.trim() ?? '';
  if (!token) {
    return null;
  }

  if (token.length > MAX_SESSION_TOKEN_LENGTH) {
    throw new HttpError(400, 'セッショントークンが長すぎます。');
  }

  return token;
};

const getClientIp = (req: Request): string => {
  const fromForwardedFor = req.headers
    .get('x-forwarded-for')
    ?.split(',')[0]
    ?.trim();
  const fromRealIp = req.headers.get('x-real-ip')?.trim();
  const fromCf = req.headers.get('cf-connecting-ip')?.trim();
  const candidate = fromForwardedFor || fromRealIp || fromCf || 'unknown';

  if (candidate.length > MAX_IP_ADDRESS_LENGTH) {
    return candidate.slice(0, MAX_IP_ADDRESS_LENGTH);
  }

  return candidate;
};

const normalizePassword = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${fieldName} は文字列で送信してください。`);
  }

  const trimmedPassword = value.trim();
  if (trimmedPassword.length === 0) {
    throw new HttpError(400, `${fieldName} を入力してください。`);
  }

  if (trimmedPassword.length > 256) {
    throw new HttpError(400, `${fieldName} が長すぎます。`);
  }

  return trimmedPassword;
};

const normalizeInteger = (
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(400, `${fieldName} は数値で送信してください。`);
  }

  if (!Number.isInteger(value)) {
    throw new HttpError(400, `${fieldName} は整数で送信してください。`);
  }

  if (value < min || value > max) {
    throw new HttpError(
      400,
      `${fieldName} は${min}〜${max}の範囲で指定してください。`,
    );
  }

  return value;
};

const normalizeClubs = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'clubs は配列で送信してください。');
  }

  if (value.length > 20) {
    throw new HttpError(400, '部活は20件まで指定できます。');
  }

  const clubs = value.map((club) => {
    if (typeof club !== 'string') {
      throw new HttpError(400, '部活名は文字列で指定してください。');
    }

    const trimmedClub = club.trim();
    if (trimmedClub.length === 0 || trimmedClub.length > 100) {
      throw new HttpError(400, '部活名が不正です。');
    }

    return trimmedClub;
  });

  if (new Set(clubs).size !== clubs.length) {
    throw new HttpError(400, '同じ部活を重複して指定できません。');
  }

  return clubs;
};

const normalizeGymTicketLimitsByClub = (
  value: unknown,
): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'gymTicketLimitsByClub はオブジェクトで送信してください。');
  }

  const entries = Object.entries(value);
  if (entries.length > 100) {
    throw new HttpError(400, '部活別上限は100件まで指定できます。');
  }

  return Object.fromEntries(entries.map(([club, limit]) => {
    const name = club.trim();
    if (name.length === 0 || name.length > 100) {
      throw new HttpError(400, '部活名が不正です。');
    }
    return [name, normalizeInteger(limit, `gymTicketLimitsByClub.${name}`, 0, 100)];
  }));
};

const normalizeClassTicketLimitsById = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'classTicketLimitsById はオブジェクトで送信してください。');
  }
  return Object.fromEntries(Object.entries(value).map(([id, limit]) => {
    if (!/^\d+$/.test(id)) {throw new HttpError(400, 'クラスIDが不正です。');}
    return [id, normalizeInteger(limit, `classTicketLimitsById.${id}`, 0, 100)];
  }));
};

const isTicketIssueMode = (value: unknown): value is TicketIssueMode =>
  typeof value === 'string' &&
  (TICKET_ISSUE_MODE_VALUES as readonly string[]).includes(value);

const normalizeTicketIssueModes = (value: unknown): TicketIssueModes => {
  if (!value || typeof value !== 'object') {
    throw new HttpError(
      400,
      'ticketIssueModes はオブジェクトで送信してください。',
    );
  }

  const raw = value as Record<string, unknown>;
  if (
    !isTicketIssueMode(raw.classInvite) ||
    !isTicketIssueMode(raw.rehearsalInvite) ||
    !isTicketIssueMode(raw.gymInvite) ||
    !isTicketIssueMode(raw.entryOnly) ||
    !isTicketIssueMode(raw.sameDayClass) ||
    !isTicketIssueMode(raw.sameDayGym) ||
    !isTicketIssueMode(raw.juniorClass) ||
    !isTicketIssueMode(raw.juniorGym) ||
    !isTicketIssueMode(raw.juniorEntryOnly)
  ) {
    throw new HttpError(400, 'ticketIssueModes の値が不正です。');
  }

  return {
    classInvite: raw.classInvite,
    rehearsalInvite: raw.rehearsalInvite,
    gymInvite: raw.gymInvite,
    entryOnly: raw.entryOnly,
    sameDayClass: raw.sameDayClass,
    sameDayGym: raw.sameDayGym,
    juniorClass: raw.juniorClass,
    juniorGym: raw.juniorGym,
    juniorEntryOnly: raw.juniorEntryOnly,
  };
};

const parseBody = (body: unknown): AdminAuthBody => {
  if (!body || typeof body !== 'object') {
    throw new HttpError(400, 'リクエストボディが不正です。');
  }

  const { action, password, currentPassword, newPassword } =
    body as AdminAuthRequest;

  if (action === 'verify') {
    return { mode: 'verifySession' };
  }

  if (action === 'logout') {
    return { mode: 'logoutSession' };
  }

  if (action === 'getTeachers') {
    return { mode: 'getTeachers' };
  }

  if (action === 'changePassword') {
    const normalizedCurrentPassword = normalizePassword(
      currentPassword,
      'currentPassword',
    );
    const normalizedNewPassword = normalizePassword(newPassword, 'newPassword');

    if (normalizedNewPassword.length < 8) {
      throw new HttpError(400, 'newPassword は8文字以上で設定してください。');
    }

    return {
      mode: 'changePassword',
      currentPassword: normalizedCurrentPassword,
      newPassword: normalizedNewPassword,
    };
  }

  if (action === 'deleteAllStudentAccounts') {
    return { mode: 'deleteAllStudentAccounts' };
  }

  if (action === 'deleteAccountsByType') {
    const { accountType } = body as AdminAuthRequest;
    if (accountType !== 'student' && accountType !== 'junior') {
      throw new HttpError(
        400,
        'accountType は student または junior を指定してください。',
      );
    }
    return { mode: 'deleteAccountsByType', accountType };
  }

  if (action === 'resetUserData' || action === 'deleteUserAccount') {
    const { accountType, userEmail } = body as AdminAuthRequest;
    if (accountType !== 'student' && accountType !== 'junior') {
      throw new HttpError(400, 'accountType は student または junior を指定してください。');
    }
    if (
      typeof userEmail !== 'string' ||
      !/^[^@\s]+@gaiensai\.local$/.test(userEmail)
    ) {
      throw new HttpError(400, 'userEmail が不正です。');
    }
    return {
      mode: action === 'resetUserData' ? 'resetUserData' : 'deleteUserAccount',
      accountType,
      userEmail,
    };
  }

  if (action === 'deleteAllTicketsAndResetCounters') {
    return { mode: 'deleteAllTicketsAndResetCounters' };
  }

  if (action === 'deleteAllFlappyLeaderboardEntries') {
    return { mode: 'deleteAllFlappyLeaderboardEntries' };
  }

  if (action === 'getStudentUsers') {
    return { mode: 'getStudentUsers' };
  }

  if (action === 'updateStudentClubs') {
    const values = body as AdminAuthRequest;
    const studentId = normalizePassword(values.studentId, 'studentId');
    if (!/^\d{5}$/.test(studentId)) {
      throw new HttpError(400, '生徒IDが不正です。');
    }

    return {
      mode: 'updateStudentClubs',
      studentId,
      clubs: normalizeClubs(values.clubs),
    };
  }

  if (action === 'getStatusDashboard') {
    return { mode: 'getStatusDashboard' };
  }

  if (action === 'getTicketManagementData') {
    return { mode: 'getTicketManagementData' };
  }

  if (action === 'cancelTicket') {
    const { code } = body as AdminAuthRequest;
    if (
      typeof code !== 'string' ||
      code.trim().length === 0 ||
      code.length > 200
    ) {
      throw new HttpError(400, 'チケットコードを指定してください。');
    }
    return { mode: 'cancelTicket', code: code.trim() };
  }

  if (action === 'adminIssueTickets') {
    const values = body as AdminAuthRequest;
    return {
      mode: 'adminIssueTickets',
      affiliation: normalizeInteger(
        values.affiliation,
        'affiliation',
        0,
        999999,
      ),
      ticketTypeId: normalizeInteger(
        values.ticketTypeId,
        'ticketTypeId',
        1,
        100,
      ),
      relationshipId: normalizeInteger(
        values.relationshipId,
        'relationshipId',
        1,
        100,
      ),
      juniorRelationshipId:
        values.juniorRelationshipId === undefined ||
        values.juniorRelationshipId === null
          ? null
          : normalizeInteger(
              values.juniorRelationshipId,
              'juniorRelationshipId',
              0,
              2,
            ),
      performanceId: normalizeInteger(
        values.performanceId,
        'performanceId',
        0,
        10000,
      ),
      scheduleId: normalizeInteger(values.scheduleId, 'scheduleId', 0, 10000),
      issueCount: normalizeInteger(values.issueCount, 'issueCount', 1, 20),
    };
  }

  if (action === 'resetUserPassword') {
    const { studentId, newPassword } = body as AdminAuthRequest;
    if (!studentId) {
      throw new HttpError(400, 'studentId を指定してください。');
    }
    return {
      mode: 'resetUserPassword',
      studentId: String(studentId),
      newPassword: normalizePassword(newPassword, 'newPassword'),
    };
  }

  if (action === 'updateTeacher') {
    const { recordId, name } = body as AdminAuthRequest;
    return {
      mode: 'updateTeacher',
      teacherId: normalizeInteger(recordId, 'recordId', 1, 1000000),
      name: normalizePassword(name, 'name'),
    };
  }

  if (action === 'updateAllTeachers') {
    const { teachers } = body as AdminAuthRequest;
    if (!Array.isArray(teachers)) {
      throw new HttpError(400, 'teachers は配列で送信してください。');
    }
    return {
      mode: 'updateAllTeachers',
      teachers: (teachers as Record<string, unknown>[]).map((t) => ({
        id: normalizeInteger(t.id, 'id', 1, 1000000),
        name: normalizePassword(t.name, 'name'),
      })),
    };
  }

  if (action === 'bulkCreateUsers') {
    const { users } = body as AdminAuthRequest;
    if (!Array.isArray(users)) {
      throw new HttpError(400, 'users は配列で送信してください。');
    }
    const validatedUsers: { id: string; password: string }[] = users.map(
      (u: Record<string, unknown>) => ({
        id: String(u.id ?? ''),
        password: String(u.password ?? ''),
      }),
    );
    return { mode: 'bulkCreateUsers', users: validatedUsers };
  }

  if (action === 'updateAcceptingStatus') {
    const { table, recordId, column, value } = body as AdminAuthRequest;
    if (typeof table !== 'string') {
      throw new HttpError(400, 'table は文字列で送信してください。');
    }
    if (typeof column !== 'string') {
      throw new HttpError(400, 'column は文字列で送信してください。');
    }
    if (typeof value !== 'boolean' && typeof value !== 'number') {
      throw new HttpError(400, 'value は真偽値または数値で送信してください。');
    }

    // バリデーション: 許可されたテーブルとカラムのみ
    const allowedUpdates: Record<string, string[]> = {
      class_performances: ['is_accepting', 'total_capacity', 'junior_capacity'],
      gym_performances: ['is_accepting', 'capacity', 'junior_capacity'],
      performances_schedule: ['is_active'],
      relationships: ['is_accepting'],
    };

    if (!allowedUpdates[table] || !allowedUpdates[table].includes(column)) {
      throw new HttpError(
        400,
        '不正なテーブルまたはカラムの更新リクエストです。',
      );
    }

    return {
      mode: 'updateAcceptingStatus',
      table,
      recordId: normalizeInteger(recordId, 'recordId', 1, 1000000),
      column,
      value,
    };
  }

  if (action === 'getSettings') {
    return { mode: 'getSettings' };
  }

  if (action === 'triggerRedeploy') {
    return { mode: 'triggerRedeploy' };
  }

  if (action === 'getOrganizationAdmins') {
    return { mode: 'getOrganizationAdmins' };
  }

  if (action === 'getClassPerformances') {
    return { mode: 'getClassPerformances' };
  }

  if (action === 'updateClassPerformance') {
    const values = body as AdminAuthRequest;
    if (values.performanceType !== 'class' && values.performanceType !== 'gym' && values.performanceType !== 'exhibition') {
      throw new HttpError(400, '公演種別が不正です。');
    }
    const className = typeof values.className === 'string' ? values.className.trim() : '';
    const title = typeof values.title === 'string' ? values.title.trim() : '';
    const description = typeof values.description === 'string' ? values.description.trim() : '';
    if (className.length === 0 || className.length > 100) {
      throw new HttpError(400, 'クラス名は1〜100文字で入力してください。');
    }
    if (title.length > 200 || description.length > 5000) {
      throw new HttpError(400, '公演タイトルまたは説明が長すぎます。');
    }
    const totalCapacity = values.performanceType === 'exhibition'
      ? 1
      : normalizeInteger(values.totalCapacity, 'totalCapacity', 1, 10000);
    const juniorCapacity = values.performanceType === 'exhibition'
      ? 0
      : normalizeInteger(values.juniorCapacity, 'juniorCapacity', 0, totalCapacity);
    const startAt = values.performanceType === 'gym' && typeof values.startAt === 'string'
      ? values.startAt : null;
    const endAt = values.performanceType === 'gym' && typeof values.endAt === 'string'
      ? values.endAt : null;
    if (values.performanceType === 'gym' && (!startAt || !endAt || Number.isNaN(Date.parse(startAt)) || Number.isNaN(Date.parse(endAt)) || Date.parse(startAt) >= Date.parse(endAt))) {
      throw new HttpError(400, '開始時刻と終了時刻を正しく入力してください。');
    }
    if (typeof values.isAccepting !== 'boolean') {
      throw new HttpError(400, 'isAccepting は真偽値で指定してください。');
    }
    return {
      mode: 'updateClassPerformance',
      id: normalizeInteger(values.recordId, 'recordId', 1, 1000000),
      className,
      title,
      description,
      totalCapacity,
      juniorCapacity,
      isAccepting: values.isAccepting,
      performanceType: values.performanceType,
      startAt,
      endAt,
    };
  }

  if (action === 'updatePerformanceSchedule') {
    const values = body as AdminAuthRequest;
    const roundName =
      typeof values.roundName === 'string' ? values.roundName.trim() : '';
    if (roundName.length === 0 || roundName.length > 200) {
      throw new HttpError(400, '公演回名は1〜200文字で入力してください。');
    }
    if (
      typeof values.startAt !== 'string' ||
      Number.isNaN(Date.parse(values.startAt))
    ) {
      throw new HttpError(400, '開始時刻を正しく入力してください。');
    }
    if (typeof values.isActive !== 'boolean') {
      throw new HttpError(400, 'isActive は真偽値で指定してください。');
    }
    return {
      mode: 'updatePerformanceSchedule',
      id: normalizeInteger(values.recordId, 'recordId', 1, 1000000),
      roundName,
      startAt: values.startAt,
      isActive: values.isActive,
    };
  }

  if (action === 'uploadClassPerformanceImage') {
    const values = body as AdminAuthRequest;
    if (values.performanceType !== 'class' && values.performanceType !== 'gym' && values.performanceType !== 'exhibition') {
      throw new HttpError(400, '公演種別が不正です。');
    }
    if (
      values.contentType !== 'image/jpeg' &&
      values.contentType !== 'image/png' &&
      values.contentType !== 'image/webp'
    ) {
      throw new HttpError(400, 'JPEG・PNG・WebP画像のみアップロードできます。');
    }
    if (typeof values.base64 !== 'string' || values.base64.length === 0) {
      throw new HttpError(400, '画像データが不正です。');
    }
    if (values.base64.length > 7_000_000) {
      throw new HttpError(400, '画像ファイルは5MB以下にしてください。');
    }
    return {
      mode: 'uploadClassPerformanceImage',
      id: normalizeInteger(values.recordId, 'recordId', 1, 1000000),
      contentType: values.contentType,
      base64: values.base64,
      performanceType: values.performanceType,
    };
  }

  if (action === 'createOrganizationAdmin') {
    const values = body as AdminAuthRequest;
    const username = normalizePassword(
      values.organizationUsername,
      'organizationUsername',
    );
    if (!/^[a-zA-Z0-9._-]{3,100}$/.test(username)) {
      throw new HttpError(
        400,
        'ユーザー名は英数字、ハイフン、アンダースコア、ピリオドで3〜100文字にしてください。',
      );
    }
    const organizationPassword = normalizePassword(
      values.organizationPassword,
      'organizationPassword',
    );
    if (organizationPassword.length < 8) {
      throw new HttpError(400, 'パスワードは8文字以上で設定してください。');
    }
    if (values.organizationKind !== 'class' && values.organizationKind !== 'gym' && values.organizationKind !== 'exhibition') {
      throw new HttpError(400, '団体種別が不正です。');
    }
    return {
      mode: 'createOrganizationAdmin',
      username,
      password: organizationPassword,
      kind: values.organizationKind,
      performanceId: normalizeInteger(
        values.organizationPerformanceId,
        'organizationPerformanceId',
        1,
        1000000,
      ),
    };
  }

  if (action === 'changeOrganizationAdminPassword') {
    const values = body as AdminAuthRequest;
    if (
      typeof values.organizationAdminId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        values.organizationAdminId,
      )
    ) {
      throw new HttpError(400, '団体管理者IDが不正です。');
    }
    const organizationPassword = normalizePassword(
      values.organizationPassword,
      'organizationPassword',
    );
    if (organizationPassword.length < 8) {
      throw new HttpError(400, 'パスワードは8文字以上で設定してください。');
    }
    return {
      mode: 'changeOrganizationAdminPassword',
      organizationAdminId: values.organizationAdminId,
      password: organizationPassword,
    };
  }

  if (action === 'changeOrganizationAdminUsername') {
    const values = body as AdminAuthRequest;
    const organizationAdminId = values.organizationAdminId;
    if (typeof organizationAdminId !== 'string' || !/^[0-9a-f-]{36}$/i.test(organizationAdminId)) {
      throw new HttpError(400, '団体管理者IDが不正です。');
    }
    const username = normalizePassword(values.organizationUsername, 'organizationUsername');
    if (!/^[a-zA-Z0-9._-]{3,100}$/.test(username)) {
      throw new HttpError(400, 'ユーザー名は英数字、ハイフン、アンダースコア、ピリオドで3〜100文字にしてください。');
    }
    return { mode: 'changeOrganizationAdminUsername', organizationAdminId, username };
  }

  if (action === 'deleteOrganizationAdmin') {
    const values = body as AdminAuthRequest;
    const organizationAdminId = values.organizationAdminId;
    if (typeof organizationAdminId !== 'string' || !/^[0-9a-f-]{36}$/i.test(organizationAdminId)) {
      throw new HttpError(400, '団体管理者IDが不正です。');
    }
    return { mode: 'deleteOrganizationAdmin', organizationAdminId };
  }

  if (action === 'deleteAllOrganizationAdmins') {
    return { mode: 'deleteAllOrganizationAdmins' };
  }

  if (action === 'bulkCreateOrganizationAdmins') {
    const values = body as AdminAuthRequest;
    if (!Array.isArray(values.organizationAdmins) || values.organizationAdmins.length === 0 || values.organizationAdmins.length > 5) {
      throw new HttpError(400, '追加するアカウントを1〜5件指定してください。');
    }
    const admins = values.organizationAdmins.map((raw) => {
      if (!raw || typeof raw !== 'object') {throw new HttpError(400, 'アカウント情報が不正です。');}
      const item = raw as Record<string, unknown>;
      const username = normalizePassword(item.username, 'username');
      if (!/^[a-zA-Z0-9._-]{3,100}$/.test(username)) {throw new HttpError(400, 'ユーザー名が不正です。');}
      const password = normalizePassword(item.password, 'password');
      if (password.length < 8) {throw new HttpError(400, 'パスワードは8文字以上で設定してください。');}
      if (item.kind !== 'class' && item.kind !== 'gym' && item.kind !== 'exhibition') {throw new HttpError(400, '団体種別が不正です。');}
      return { username, password, kind: item.kind as 'class' | 'gym' | 'exhibition', performanceId: normalizeInteger(item.performanceId, 'performanceId', 1, 1000000) };
    });
    if (new Set(admins.map((admin) => admin.username)).size !== admins.length) {throw new HttpError(400, '一括作成内でユーザー名が重複しています。');}
    return { mode: 'bulkCreateOrganizationAdmins', admins };
  }

  if (action === 'updateSettings') {
    const {
      eventYear,
      showLength,
      maxTicketsPerOtherClassUser,
      maxTicketsPerOtherPerformanceUser,
      classTicketLimitsById,
      maxTicketsPerOtherClubUser,
      gymTicketLimitsByClub,
      maxTicketsPerJuniorUser,
      juniorReleaseOpen,
      ticketIssuingEnabled,
      defaultClassTotalCapacity,
      defaultClassJuniorCapacity,
      defaultGymCapacity,
      defaultGymJuniorCapacity,
      maxAdmissionOnlyJuniorAccounts,
    } = body as AdminAuthRequest;

    const total = normalizeInteger(
      defaultClassTotalCapacity,
      'defaultClassTotalCapacity',
      1,
      1000,
    );
    const junior = normalizeInteger(
      defaultClassJuniorCapacity,
      'defaultClassJuniorCapacity',
      0,
      1000,
    );

    if (junior > total) {
      throw new HttpError(400, '中学生枠は合計定員以下で指定してください。');
    }
    const gymCapacity = normalizeInteger(
      defaultGymCapacity,
      'defaultGymCapacity',
      1,
      2000,
    );
    const gymJunior = normalizeInteger(
      defaultGymJuniorCapacity,
      'defaultGymJuniorCapacity',
      0,
      2000,
    );
    if (gymJunior > gymCapacity) {
      throw new HttpError(
        400,
        '体育館公演の中学生枠は合計定員以下で指定してください。',
      );
    }

    if (typeof juniorReleaseOpen !== 'boolean') {
      throw new HttpError(
        400,
        'juniorReleaseOpen は真偽値で送信してください。',
      );
    }
    if (typeof ticketIssuingEnabled !== 'boolean') {
      throw new HttpError(
        400,
        'ticketIssuingEnabled は真偽値で送信してください。',
      );
    }

    return {
      mode: 'updateSettings',
      eventYear: normalizeInteger(eventYear, 'eventYear', 2020, 2100),
      showLength: normalizeInteger(showLength, 'showLength', 1, 300),
      maxTicketsPerOtherClassUser: normalizeInteger(
        maxTicketsPerOtherClassUser,
        'maxTicketsPerOtherClassUser',
        0,
        100,
      ),
      maxTicketsPerOtherPerformanceUser: normalizeInteger(
        maxTicketsPerOtherPerformanceUser,
        'maxTicketsPerOtherPerformanceUser',
        0,
        500,
      ),
      classTicketLimitsById: normalizeClassTicketLimitsById(classTicketLimitsById),
      maxTicketsPerOtherClubUser: normalizeInteger(
        maxTicketsPerOtherClubUser,
        'maxTicketsPerOtherClubUser',
        1,
        100,
      ),
      gymTicketLimitsByClub: normalizeGymTicketLimitsByClub(
        gymTicketLimitsByClub,
      ),
      maxTicketsPerJuniorUser: normalizeInteger(
        maxTicketsPerJuniorUser,
        'maxTicketsPerJuniorUser',
        1,
        100,
      ),
      juniorReleaseOpen,
      ticketIssuingEnabled,
      defaultClassTotalCapacity: total,
      defaultClassJuniorCapacity: junior,
      defaultGymCapacity: gymCapacity,
      defaultGymJuniorCapacity: gymJunior,
      maxAdmissionOnlyJuniorAccounts: normalizeInteger(
        maxAdmissionOnlyJuniorAccounts,
        'maxAdmissionOnlyJuniorAccounts',
        0,
        100,
      ),
    };
  }

  if (action === 'updateTicketTypeSettings') {
    const { activeTicketTypeIds, ticketIssueModes } = body as AdminAuthRequest;
    if (!Array.isArray(activeTicketTypeIds)) {
      throw new HttpError(
        400,
        'activeTicketTypeIds は数値配列で送信してください。',
      );
    }

    const normalizedIds = Array.from(
      new Set(
        activeTicketTypeIds.map((value) =>
          normalizeInteger(value, 'activeTicketTypeIds', 1, 1000),
        ),
      ),
    );

    for (const id of normalizedIds) {
      if (
        !MANAGED_TICKET_TYPE_IDS.includes(
          id as (typeof MANAGED_TICKET_TYPE_IDS)[number],
        )
      ) {
        throw new HttpError(400, `管理対象外の券種IDです: ${id}`);
      }
    }

    return {
      mode: 'updateTicketTypeSettings',
      activeTicketTypeIds: normalizedIds,
      ticketIssueModes: normalizeTicketIssueModes(ticketIssueModes),
    };
  }

  if (action === 'login' || typeof action === 'undefined') {
    const isLegacyChangePasswordRequest =
      typeof currentPassword !== 'undefined' ||
      typeof newPassword !== 'undefined';
    if (isLegacyChangePasswordRequest) {
      const normalizedCurrentPassword = normalizePassword(
        currentPassword,
        'currentPassword',
      );
      const normalizedNewPassword = normalizePassword(
        newPassword,
        'newPassword',
      );

      if (normalizedNewPassword.length < 8) {
        throw new HttpError(400, 'newPassword は8文字以上で設定してください。');
      }

      return {
        mode: 'changePassword',
        currentPassword: normalizedCurrentPassword,
        newPassword: normalizedNewPassword,
      };
    }

    return {
      mode: 'login',
      password: normalizePassword(password, 'password'),
    };
  }

  if (action === 'updateJuniorPassword') {
    const { juniorPassword } = body as AdminAuthRequest;
    return {
      mode: 'updateJuniorPassword',
      juniorPassword: String(juniorPassword ?? ''),
    };
  }

  if (action === 'getJuniorPassword') {
    return { mode: 'getJuniorPassword' };
  }

  if (action === 'validateJuniorSecretCode') {
    const { secretCode } = body as AdminAuthRequest;
    return {
      mode: 'validateJuniorSecretCode',
      secretCode: String(secretCode ?? ''),
    };
  }

  throw new HttpError(400, 'action が不正です。');
};

const fetchAdminConfig = async (adminClient: SupabaseClient) => {
  const { data, error } = await adminClient
    .from('configs')
    .select('id, admin_password')
    .limit(1);

  if (error) {
    throw error;
  }

  const config = data?.[0] as AdminConfigRow | undefined;
  if (!config || typeof config.id !== 'number') {
    throw new HttpError(500, 'configs.id が取得できませんでした。');
  }

  if (
    typeof config.admin_password !== 'string' ||
    config.admin_password.length === 0
  ) {
    throw new HttpError(500, '管理者パスワードが設定されていません。');
  }

  if (!isBcryptHash(config.admin_password)) {
    throw new HttpError(
      500,
      'configs.admin_password が bcrypt ハッシュ形式ではありません。',
    );
  }

  return {
    id: config.id,
    passwordHash: config.admin_password,
  };
};

const fetchAdminSettings = async (adminClient: SupabaseClient) => {
  const { data, error } = await adminClient
    .from('configs')
    .select(
      'id, event_year, show_length, max_tickets_per_other_class_user, max_tickets_per_other_performance_user, max_tickets_per_other_club_user, gym_ticket_limits_by_club, max_tickets_per_junior_user, max_admission_only_junior_accounts, junior_release_open, is_active',
    )
    .limit(1);

  if (error) {
    throw error;
  }

  const row = data?.[0] as AdminSettingsRow | undefined;
  if (!row || typeof row.id !== 'number') {
    throw new HttpError(500, 'configs が取得できませんでした。');
  }

  return row;
};

const fetchTicketIssueControls = async (
  adminClient: SupabaseClient,
): Promise<TicketIssueModes> => {
  const { data, error } = await adminClient
    .from('ticket_issue_controls')
    .select(
      'class_invite_mode, rehearsal_invite_mode, gym_invite_mode, entry_only_mode, same_day_class_mode, same_day_gym_mode, junior_class_mode, junior_gym_mode, junior_entry_only_mode',
    )
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const row = data as TicketIssueControlsRow | null;
  if (!row) {
    return DEFAULT_TICKET_ISSUE_MODES;
  }

  return {
    classInvite: row.class_invite_mode,
    rehearsalInvite: row.rehearsal_invite_mode,
    gymInvite: row.gym_invite_mode,
    entryOnly: row.entry_only_mode,
    sameDayClass: row.same_day_class_mode,
    sameDayGym: row.same_day_gym_mode,
    juniorClass: row.junior_class_mode,
    juniorGym: row.junior_gym_mode,
    juniorEntryOnly: row.junior_entry_only_mode,
  };
};

const fetchMaxCapacities = async (adminClient: SupabaseClient) => {
  const { data: classData, error: classError } = await adminClient
    .from('class_performances')
    .select('total_capacity, junior_capacity');

  if (classError) {
    throw classError;
  }

  const { data: gymData, error: gymError } = await adminClient
    .from('gym_performances')
    .select('capacity, junior_capacity');

  if (gymError) {
    throw gymError;
  }

  const maxClassTotal =
    classData && classData.length > 0
      ? Math.max(...classData.map((row) => row.total_capacity ?? 0))
      : null;
  const maxClassJunior =
    classData && classData.length > 0
      ? Math.max(...classData.map((row) => row.junior_capacity ?? 0))
      : null;
  const maxGym =
    gymData && gymData.length > 0
      ? Math.max(...gymData.map((row) => row.capacity ?? 0))
      : null;
  const maxGymJunior =
    gymData && gymData.length > 0
      ? Math.max(...gymData.map((row) => row.junior_capacity ?? 0))
      : null;

  return { maxClassTotal, maxClassJunior, maxGym, maxGymJunior };
};

const isBcryptHash = (value: string) => /^\$2[aby]\$\d{2}\$.{53}$/.test(value);

const getRateLimitRow = async (
  adminClient: SupabaseClient,
  ipAddress: string,
): Promise<AdminRateLimitRow | null> => {
  const { data, error } = await adminClient
    .from('admin_auth_rate_limits')
    .select('ip_address, failed_attempts, locked_until')
    .eq('ip_address', ipAddress)
    .limit(1);

  if (error) {
    throw error;
  }

  const row = data?.[0] as AdminRateLimitRow | undefined;
  return row ?? null;
};

const getRemainingLockSeconds = (lockedUntil: string): number => {
  const remainingMs = new Date(lockedUntil).getTime() - Date.now();
  return Math.max(1, Math.ceil(remainingMs / 1000));
};

const ensureIpIsNotLocked = (rateLimitRow: AdminRateLimitRow | null) => {
  if (!rateLimitRow?.locked_until) {
    return;
  }

  const lockExpiresAtMs = new Date(rateLimitRow.locked_until).getTime();
  if (Number.isNaN(lockExpiresAtMs) || lockExpiresAtMs <= Date.now()) {
    return;
  }

  const retryAfterSeconds = getRemainingLockSeconds(rateLimitRow.locked_until);
  throw new HttpError(
    429,
    `試行回数が上限に達しました。${retryAfterSeconds}秒後に再試行してください。`,
  );
};

const registerFailedAttempt = async (
  adminClient: SupabaseClient,
  ipAddress: string,
  rateLimitRow: AdminRateLimitRow | null,
) => {
  const now = new Date();
  const lockStillActive =
    typeof rateLimitRow?.locked_until === 'string' &&
    new Date(rateLimitRow.locked_until).getTime() > now.getTime();

  const baseFailedAttempts = lockStillActive
    ? 0
    : (rateLimitRow?.failed_attempts ?? 0);
  const nextFailedAttempts = baseFailedAttempts + 1;
  const shouldLock = nextFailedAttempts >= ADMIN_AUTH_MAX_FAILED_ATTEMPTS;
  const lockedUntil = shouldLock
    ? new Date(now.getTime() + ADMIN_AUTH_LOCK_DURATION_MS).toISOString()
    : null;

  const { error } = await adminClient.from('admin_auth_rate_limits').upsert(
    {
      ip_address: ipAddress,
      failed_attempts: shouldLock ? 0 : nextFailedAttempts,
      last_failed_at: now.toISOString(),
      locked_until: lockedUntil,
    },
    { onConflict: 'ip_address' },
  );

  if (error) {
    throw error;
  }

  return {
    shouldLock,
    lockedUntil,
    remainingAttempts: shouldLock
      ? 0
      : ADMIN_AUTH_MAX_FAILED_ATTEMPTS - nextFailedAttempts,
  };
};

const clearFailedLoginAttempts = async (
  adminClient: SupabaseClient,
  ipAddress: string,
) => {
  const { error } = await adminClient
    .from('admin_auth_rate_limits')
    .delete()
    .eq('ip_address', ipAddress);

  if (error) {
    throw error;
  }
};

const createSession = async (adminClient: SupabaseClient) => {
  const token = createRawToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(
    Date.now() + ADMIN_CONTROL_PANEL_SESSION_DURATION_MS,
  ).toISOString();

  const { error } = await adminClient.from('admin_sessions').insert({
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  if (error) {
    throw error;
  }

  return {
    token,
    expiresAt,
  };
};

const findActiveSession = async (
  adminClient: SupabaseClient,
  token: string,
): Promise<(AdminSessionRow & { tokenHash: string }) | null> => {
  const tokenHash = await hashToken(token);
  const nowIso = new Date().toISOString();

  const { data, error } = await adminClient
    .from('admin_sessions')
    .select('id, expires_at')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .limit(1);

  if (error) {
    throw error;
  }

  const session = data?.[0] as AdminSessionRow | undefined;
  if (!session) {
    return null;
  }

  return { ...session, tokenHash };
};

const requireValidSession = async (
  adminClient: SupabaseClient,
  req: Request,
) => {
  const sessionToken = readSessionToken(req);
  if (!sessionToken) {
    throw new HttpError(401, 'セッションが無効です。再ログインしてください。');
  }

  const session = await findActiveSession(adminClient, sessionToken);
  if (!session) {
    throw new HttpError(401, 'セッションが無効です。再ログインしてください。');
  }

  return session;
};

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({
        error: 'Method not allowed',
      }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  }

  try {
    const body = parseBody(await req.json());

    const supabaseUrl = getEnv('SUPABASE_URL');
    const secretKey = getEnv('FOR_ADMIN_SUPABASE_SECRET_KEY');

    const adminClient = createClient(supabaseUrl, secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    if (body.mode === 'verifySession') {
      const token = readSessionToken(req);
      if (!token) {
        return new Response(
          JSON.stringify({
            authenticated: false,
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          },
        );
      }

      const session = await findActiveSession(adminClient, token);
      if (!session) {
        return new Response(
          JSON.stringify({
            authenticated: false,
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          },
        );
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({
          authenticated: true,
          expiresAt: session.expires_at,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    if (body.mode === 'logoutSession') {
      const token = readSessionToken(req);
      if (token) {
        const tokenHash = await hashToken(token);
        await adminClient
          .from('admin_sessions')
          .update({ revoked_at: new Date().toISOString() })
          .eq('token_hash', tokenHash);
      }

      return new Response(
        JSON.stringify({
          loggedOut: true,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    if (body.mode === 'getTeachers') {
      const session = await requireValidSession(adminClient, req);
      const { data, error } = await adminClient
        .from('teachers')
        .select('id, grade, class_id, name')
        .order('grade', { ascending: true })
        .order('class_id', { ascending: true });

      if (error) {
        throw error;
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(JSON.stringify({ teachers: data }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    if (body.mode === 'updateTeacher') {
      const session = await requireValidSession(adminClient, req);
      const { error } = await adminClient
        .from('teachers')
        .update({ name: body.name })
        .eq('id', body.teacherId);

      if (error) {
        throw error;
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'updateAllTeachers') {
      const session = await requireValidSession(adminClient, req);

      for (const t of body.teachers) {
        const { error } = await adminClient
          .from('teachers')
          .update({ name: t.name })
          .eq('id', t.id);

        if (error) {
          throw error;
        }
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'resetUserData' || body.mode === 'deleteUserAccount') {
      const session = await requireValidSession(adminClient, req);
      const { data, error: listError } = await adminClient.auth.admin.listUsers({
        perPage: 1000,
      });
      if (listError) {
        throw listError;
      }
      const authUser = data.users.find(
        (user) => user.email?.toLowerCase() === body.userEmail,
      );
      if (!authUser) {
        throw new HttpError(404, '対象のAuthユーザーが見つかりません。');
      }
      const localPart = body.userEmail.split('@')[0] ?? '';
      const isStudent = /^\d+$/.test(localPart) &&
        Number(localPart) >= 10000 && Number(localPart) <= 40000;
      if ((body.accountType === 'student') !== isStudent) {
        throw new HttpError(400, '対象アカウントの種類が一致しません。');
      }

      if (body.mode === 'resetUserData' && isStudent) {
        const { data: studentProfile, error: studentProfileError } =
          await adminClient
            .from('users')
            .select('id')
            .eq('email', body.userEmail)
            .maybeSingle();
        if (studentProfileError) {
          throw studentProfileError;
        }
        if (!studentProfile) {
          throw new HttpError(400, '初回登録が未完了の生徒アカウントです。');
        }
      }

      const { count: ticketCount, error: ticketCountError } = await adminClient
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', authUser.id);
      if (ticketCountError) {
        throw ticketCountError;
      }
      const { error: deleteTicketsError } = await adminClient
        .from('tickets')
        .delete()
        .eq('user_id', authUser.id);
      if (deleteTicketsError) {
        throw deleteTicketsError;
      }
      const { error: deleteProfileError } = await adminClient
        .from('users')
        .delete()
        .eq('email', body.userEmail);
      if (deleteProfileError) {
        throw deleteProfileError;
      }

      if (body.mode === 'deleteUserAccount') {
        const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(
          authUser.id,
        );
        if (deleteAuthError) {
          throw deleteAuthError;
        }
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({
          deletedTickets: ticketCount ?? 0,
          deletedUserData: true,
          deletedAuthUser: body.mode === 'deleteUserAccount',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    if (
      body.mode === 'deleteAllStudentAccounts' ||
      body.mode === 'deleteAccountsByType'
    ) {
      const session = await requireValidSession(adminClient, req);

      const resolveAccountType = (
        email?: string | null,
      ): 'student' | 'junior' | null => {
        if (!email || !email.endsWith('@gaiensai.local')) {
          return null;
        }

        const localPart = email.split('@')[0] ?? '';
        const asNumber = Number(localPart);
        if (
          Number.isInteger(asNumber) &&
          asNumber >= 10000 &&
          asNumber <= 40000
        ) {
          return 'student';
        }
        return 'junior';
      };

      const targetType: 'student' | 'junior' =
        body.mode === 'deleteAccountsByType' ? body.accountType : 'student';

      // 生徒アカウントを最大1000件取得
      const {
        data: { users },
        error: listError,
      } = await adminClient.auth.admin.listUsers({
        perPage: 1000,
      });

      if (listError) {
        throw listError;
      }

      // accountType に応じた対象ユーザーのみ抽出
      const usersToDelete = users.filter(
        (u) => resolveAccountType(u.email) === targetType,
      );

      // CPU時間制限(soft limit)を回避するため、1回のリクエストでの処理数を制限し、バッチサイズを最適化
      // また、スプレッド構文による配列結合を避け、CPU負荷を軽減
      const MAX_PROCESS_PER_REQUEST = 200;
      const targets = usersToDelete.slice(0, MAX_PROCESS_PER_REQUEST);
      const BATCH_SIZE = 50;

      let deletedCount = 0;
      const errors: string[] = [];
      const deletedAuthIds: string[] = [];
      const deletedEmails: string[] = [];

      for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        const batch = targets.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map((u) => adminClient.auth.admin.deleteUser(u.id)),
        );

        for (const [index, res] of results.entries()) {
          if (res.error) {
            errors.push(res.error.message);
          } else {
            deletedCount++;
            const deletedUser = batch[index];
            deletedAuthIds.push(deletedUser.id);
            if (deletedUser.email) {
              deletedEmails.push(deletedUser.email);
            }
          }
        }
      }

      if (deletedAuthIds.length > 0 || deletedEmails.length > 0) {
        if (deletedAuthIds.length > 0) {
          const { error: deleteUsersByIdError } = await adminClient
            .from('users')
            .delete()
            .in('id', deletedAuthIds);
          if (deleteUsersByIdError) {
            errors.push(
              `public.users(id) delete failed: ${deleteUsersByIdError.message}`,
            );
          }
        }

        if (deletedEmails.length > 0) {
          const { error: deleteUsersByEmailError } = await adminClient
            .from('users')
            .delete()
            .in('email', deletedEmails);
          if (deleteUsersByEmailError) {
            errors.push(
              `public.users(email) delete failed: ${deleteUsersByEmailError.message}`,
            );
          }
        }
      }

      // 生徒アカウントを最大1000件取得
      const {
        data: { users: remainingUsers },
        error,
      } = await adminClient.auth.admin.listUsers({
        perPage: 1000,
      });

      if (error) {
        throw error;
      }

      // accountType に応じた対象ユーザーの残数
      const usersRemaining = remainingUsers.filter(
        (u) => resolveAccountType(u.email) === targetType,
      );

      const remaining = usersRemaining.length;
      let juniorCountersReset = false;

      // 中学生アカウントを全件削除した後に、利用形態ごとの集計値も初期化する。
      // どちらも単一行のカウンターテーブルなので、行自体は残して値だけリセットする。
      if (targetType === 'junior' && remaining === 0) {
        const { error: resetSplitCountersError } = await adminClient
          .from('junior_account_split_counters')
          .update({
            separate_on_registration_count: 0,
            later_split_count: 0,
          })
          .eq('id', 1);

        if (resetSplitCountersError) {
          throw resetSplitCountersError;
        }

        const { error: resetAdmissionOnlyCountError } = await adminClient
          .from('junior_admission_only_account_counts')
          .update({ admission_only_count: 0 })
          .eq('id', 1);

        if (resetAdmissionOnlyCountError) {
          throw resetAdmissionOnlyCountError;
        }

        juniorCountersReset = true;
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({
          deleted: true,
          accountType: targetType,
          count: deletedCount,
          remaining, // 残数があることをフロントに伝える
          juniorCountersReset,
          errors: errors.length > 0 ? errors : undefined,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    if (body.mode === 'deleteAllTicketsAndResetCounters') {
      const session = await requireValidSession(adminClient, req);

      const { count: ticketCount, error: countError } = await adminClient
        .from('tickets')
        .select('id', { count: 'exact', head: true });

      if (countError) {
        throw countError;
      }

      const { error: deleteTicketsError } = await adminClient
        .from('tickets')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (deleteTicketsError) {
        throw deleteTicketsError;
      }

      const { error: resetClassCountersError } = await adminClient
        .from('class_ticket_counters')
        .update({
          issued_general: 0,
          issued_junior: 0,
          issued_other: 0,
          updated_at: new Date().toISOString(),
        })
        .gte('issued_general', 0);

      if (resetClassCountersError) {
        throw resetClassCountersError;
      }

      const { error: resetGymCountersError } = await adminClient
        .from('gym_ticket_counters')
        .update({
          issued_count: 0,
          updated_at: new Date().toISOString(),
        })
        .gte('issued_count', 0);

      if (resetGymCountersError) {
        throw resetGymCountersError;
      }

      const { error: resetCodeCountersError } = await adminClient
        .from('ticket_code_counters')
        .update({
          last_value: 0,
          updated_at: new Date().toISOString(),
        })
        .gte('last_value', 0);

      if (resetCodeCountersError) {
        throw resetCodeCountersError;
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({
          deleted: true,
          deletedTicketCount: ticketCount ?? 0,
          countersReset: true,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    if (body.mode === 'deleteAllFlappyLeaderboardEntries') {
      const session = await requireValidSession(adminClient, req);

      const { count: leaderboardEntryCount, error: countError } =
        await adminClient
          .from('flappy_leaderboard')
          .select('id', { count: 'exact', head: true });

      if (countError) {
        throw countError;
      }

      const { error: deleteError } = await adminClient
        .from('flappy_leaderboard')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (deleteError) {
        throw deleteError;
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({
          deleted: true,
          deletedLeaderboardEntryCount: leaderboardEntryCount ?? 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    if (body.mode === 'bulkCreateUsers') {
      const session = await requireValidSession(adminClient, req);

      const results = { created: 0, skipped: 0, errors: [] as string[] };
      const failedUsers: { id: string; password: string }[] = [];
      const skippedUsers: { id: string; password: string }[] = [];

      // バッチ内を並列実行して高速化
      const promises = body.users.map(
        async (user: { id: string; password: string }) => {
          const email = `${user.id}@gaiensai.local`;
          const { error } = await adminClient.auth.admin.createUser({
            email,
            password: user.password,
            email_confirm: true,
            user_metadata: { student_id: user.id },
          });

          if (error) {
            const normalizedErrorMessage = error.message.toLowerCase();
            if (
              normalizedErrorMessage.includes('already registered') ||
              normalizedErrorMessage.includes('already been registered')
            ) {
              return { type: 'skipped', user };
            }
            return {
              type: 'error',
              message: `${user.id}: ${error.message}`,
              user,
            };
          }
          return { type: 'created' };
        },
      );

      const rawResults = await Promise.all(promises);
      rawResults.forEach((res) => {
        if (res.type === 'created') {
          results.created++;
        } else if (res.type === 'skipped') {
          results.skipped++;
          skippedUsers.push(res.user!);
        } else if (res.type === 'error') {
          results.errors.push(res.message!);
          failedUsers.push(res.user!);
        }
      });

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({ ...results, failedUsers, skippedUsers }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    if (body.mode === 'getStudentUsers') {
      const session = await requireValidSession(adminClient, req);

      // Auth API は1回につき最大1000件のため、全ページを取得する。
      const users = [];
      for (let page = 1; ; page++) {
        const {
          data: { users: pageUsers },
          error,
        } = await adminClient.auth.admin.listUsers({
          page,
          perPage: ADMIN_LIST_PAGE_SIZE,
        });
        if (error) {
          throw error;
        }
        users.push(...pageUsers);
        if (pageUsers.length < ADMIN_LIST_PAGE_SIZE) {
          break;
        }
      }

      const authUserEmails = users.flatMap((user) =>
        user.email ? [user.email] : [],
      );
      const PROFILE_FETCH_BATCH_SIZE = 50;
      const userProfiles: {
        id: string;
        email: string;
        clubs: string[] | null;
        junior_usage_type: number | null;
        application_day: string | null;
      }[] = [];

      for (
        let index = 0;
        index < authUserEmails.length;
        index += PROFILE_FETCH_BATCH_SIZE
      ) {
        const { data, error: profilesError } = await adminClient
          .from('users')
          .select('id, email, clubs, junior_usage_type, application_day')
          .in(
            'email',
            authUserEmails.slice(index, index + PROFILE_FETCH_BATCH_SIZE),
          );

        if (profilesError) {
          throw profilesError;
        }

        userProfiles.push(...(data ?? []));
      }

      const clubsByUserEmail = new Map(
        userProfiles.map((profile) => [
          profile.email.toLowerCase(),
          profile.clubs ?? [],
        ]),
      );
      const juniorProfileByUserEmail = new Map(
        userProfiles.map((profile) => [
          profile.email.toLowerCase(),
          {
            juniorUsageType: profile.junior_usage_type,
            applicationDay: profile.application_day,
          },
        ]),
      );
      const registeredUserEmails = new Set(
        userProfiles.map((profile) => profile.email.toLowerCase()),
      );

      // @gaiensai.local のドメインを持つユーザーのみを抽出
      const studentUsers = users
        .filter((u) => u.email?.endsWith('@gaiensai.local'))
        .map((u) => ({
          studentId: u.user_metadata?.student_id || u.email?.split('@')[0],
          email: u.email,
          clubs: clubsByUserEmail.get(u.email?.toLowerCase() ?? '') ?? [],
          isInitialRegistrationComplete: registeredUserEmails.has(
            u.email?.toLowerCase() ?? '',
          ),
          juniorUsageType:
            juniorProfileByUserEmail.get(u.email?.toLowerCase() ?? '')
              ?.juniorUsageType ?? null,
          applicationDay:
            juniorProfileByUserEmail.get(u.email?.toLowerCase() ?? '')
              ?.applicationDay ?? null,
          lastSignIn: u.last_sign_in_at,
          createdAt: u.created_at,
        }))
        .sort((a, b) => a.studentId.localeCompare(b.studentId));

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(JSON.stringify({ users: studentUsers }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'getStatusDashboard') {
      const session = await requireValidSession(adminClient, req);
      const [dashboardResult, juniorStatusResult] = await Promise.all([
        adminClient.rpc('get_admin_status_dashboard'),
        adminClient.rpc('get_admin_junior_status_dashboard'),
      ]);

      if (dashboardResult.error) {
        throw dashboardResult.error;
      }
      if (juniorStatusResult.error) {
        throw juniorStatusResult.error;
      }

      const dashboard = {
        ...(dashboardResult.data as Record<string, unknown>),
        juniorStatus: juniorStatusResult.data,
      };

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(JSON.stringify({ dashboard }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'updateStudentClubs') {
      const session = await requireValidSession(adminClient, req);
      const { data: updatedUser, error: updateError } = await adminClient
        .from('users')
        .update({ clubs: body.clubs.length > 0 ? body.clubs : null })
        .eq('email', `${body.studentId}@gaiensai.local`)
        .select('id')
        .maybeSingle();

      if (updateError) {
        throw updateError;
      }
      if (!updatedUser) {
        throw new HttpError(404, '対象の生徒アカウントが見つかりませんでした。');
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'getTicketManagementData') {
      const session = await requireValidSession(adminClient, req);
      const [
        tickets,
        ticketUsers,
        relationships,
        ticketTypes,
        classTickets,
        gymTickets,
        classes,
        schedules,
        gyms,
      ] = await Promise.all([
        fetchAllRows((from, to) =>
          adminClient
            .from('tickets')
            .select(
              'id, code, signature, status, created_at, user_id, relationship, ticket_type, person_count, ticket_name',
            )
            .order('created_at', { ascending: false })
            .range(from, to),
        ),
        fetchAllRows((from, to) =>
          adminClient.from('users').select('id, email, affiliation').range(from, to),
        ),
        fetchAllRows((from, to) =>
          adminClient.from('relationships').select('id, name').range(from, to),
        ),
        fetchAllRows((from, to) =>
          adminClient.from('ticket_types').select('id, name, type').range(from, to),
        ),
        fetchAllRows((from, to) =>
          adminClient.from('class_tickets').select('id, class_id, round_id').range(from, to),
        ),
        fetchAllRows((from, to) =>
          adminClient.from('gym_tickets').select('id, performance_id').range(from, to),
        ),
        fetchAllRows((from, to) =>
          adminClient
            .from('class_performances')
            .select('id, class_name, title, total_capacity, junior_capacity')
            .range(from, to),
        ),
        fetchAllRows((from, to) =>
          adminClient
            .from('performances_schedule')
            .select('id, round_name, start_at')
            .range(from, to),
        ),
        fetchAllRows((from, to) =>
          adminClient
            .from('gym_performances')
            .select('id, group_name, round_name, start_at, capacity, junior_capacity')
            .range(from, to),
        ),
      ]);

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);
      return new Response(
        JSON.stringify({
          tickets,
          users: ticketUsers,
          relationships,
          ticketTypes,
          classTickets,
          gymTickets,
          classes,
          schedules,
          gyms,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    if (body.mode === 'cancelTicket') {
      const session = await requireValidSession(adminClient, req);
      const { data: ticket, error: findError } = await adminClient
        .from('tickets')
        .select('status')
        .eq('code', body.code)
        .maybeSingle();
      if (findError) {
        throw findError;
      }
      if (!ticket) {
        throw new HttpError(404, 'チケットが見つかりません。');
      }
      if ((ticket as { status: string }).status !== 'valid') {
        throw new HttpError(409, '有効なチケットのみ取り消せます。');
      }
      const { error: updateError } = await adminClient
        .from('tickets')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('code', body.code);
      if (updateError) {
        throw updateError;
      }
      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);
      return new Response(JSON.stringify({ cancelled: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'adminIssueTickets') {
      const session = await requireValidSession(adminClient, req);
      const [
        { data: user, error: userError },
        { data: ticketType, error: typeError },
        { data: config, error: configError },
      ] = await Promise.all([
        adminClient
          .from('users')
          .select('id, affiliation')
          .eq('affiliation', body.affiliation)
          .maybeSingle(),
        adminClient
          .from('ticket_types')
          .select('id, name, type')
          .eq('id', body.ticketTypeId)
          .maybeSingle(),
        adminClient
          .from('configs')
          .select('event_year')
          .order('id', { ascending: true })
          .maybeSingle(),
      ]);
      if (userError || typeError || configError) {
        throw userError ?? typeError ?? configError;
      }
      if (!user) {
        throw new HttpError(
          404,
          '指定した affiliation の利用者が見つかりません。先に利用者登録を確認してください。',
        );
      }
      if (!ticketType) {
        throw new HttpError(404, 'チケット種別が見つかりません。');
      }
      if (
        ticketType.name === 'クラス公演(リハーサル)' &&
        ticketType.type === '招待券'
      ) {
        throw new HttpError(
          400,
          'クラス公演(リハーサル)（招待券）は管理者発券に対応していません。',
        );
      }
      const isJuniorTicket = ticketType.type === '中学生券';
      if (isJuniorTicket && body.juniorRelationshipId === null) {
        throw new HttpError(400, '中学生券の利用者区分を選択してください。');
      }
      const databaseRelationshipId = isJuniorTicket ? 1 : body.relationshipId;
      const isAdmission = ticketType.name === '入場専用券';
      const isGym = String(ticketType.name ?? '').includes('体育館');
      if (isAdmission) {
        if (body.performanceId !== 0 || body.scheduleId !== 0) {
          throw new HttpError(400, '入場専用券には公演を指定できません。');
        }
      } else if (isGym) {
        if (body.performanceId < 1) {
          throw new HttpError(400, '体育館公演を選択してください。');
        }
      } else if (body.performanceId < 1 || body.scheduleId < 1) {
        throw new HttpError(400, '公演と公演回を選択してください。');
      }
      const issuedYear = Number(config?.event_year);
      if (!Number.isInteger(issuedYear)) {
        throw new HttpError(500, '年度設定を取得できませんでした。');
      }
      const yearForCode = issuedYear % 2 ** Number(YEAR_BITS);
      const prefixDigits = `${String(body.affiliation).padStart(5, '0')}${String(body.ticketTypeId).padStart(1, '0')}${String(databaseRelationshipId).padStart(1, '0')}${String(body.performanceId).padStart(2, '0')}${String(body.scheduleId).padStart(2, '0')}${String(yearForCode).padStart(2, '0')}`;
      const basePrefix = generateManualCode(BigInt(prefixDigits));
      const { data: endSerial, error: counterError } = await adminClient.rpc(
        'increment_ticket_code_counter',
        {
          p_prefix: basePrefix,
          p_increment: body.issueCount,
          p_max_value: 2 ** Number(SERIAL_BITS),
        },
      );
      if (counterError) {
        throw new HttpError(409, counterError.message);
      }
      const issuedTickets = await issueWithRollback({
        adminClient: adminClient as unknown as RpcClient,
        userId: user.id,
        issueCount: body.issueCount,
        issueMode: isGym ? 'gym' : 'class',
        ticketTypeId: body.ticketTypeId,
        relationshipId: databaseRelationshipId,
        performanceId: body.performanceId,
        scheduleId: body.scheduleId,
        affiliation: body.affiliation,
        issuedYear,
        basePrefix,
        endSerial: Number(endSerial),
        encodingRelationshipId: body.juniorRelationshipId ?? undefined,
        generateCode: generateTicketCode,
        signTicketCode: signCode,
      });
      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);
      return new Response(JSON.stringify({ issuedTickets }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'resetUserPassword') {
      const session = await requireValidSession(adminClient, req);

      const email = `${body.studentId}@gaiensai.local`;

      // IDから対象ユーザーを検索 (Auth Admin APIを使用)
      // デフォルトは50件なので、perPageを指定して検索対象を広げる
      const {
        data: { users },
        error: listError,
      } = await adminClient.auth.admin.listUsers({
        perPage: 1000,
      });

      if (listError) {
        throw listError;
      }

      const authUser = users.find((u) => u.email === email);

      if (!authUser) {
        throw new HttpError(
          404,
          '対象の生徒アカウントが見つかりませんでした。',
        );
      }

      // パスワードを更新
      const { error: updateError } =
        await adminClient.auth.admin.updateUserById(authUser.id, {
          password: body.newPassword,
        });

      if (updateError) {
        throw updateError;
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'triggerRedeploy') {
      const session = await requireValidSession(adminClient, req);
      await triggerCloudflarePagesDeploy();
      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);
      return new Response(JSON.stringify({ redeployTriggered: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'getSettings') {
      const session = await requireValidSession(adminClient, req);
      const settings = await fetchAdminSettings(adminClient);
      const maxCapacities = await fetchMaxCapacities(adminClient);
      const ticketIssueModes = await fetchTicketIssueControls(adminClient);
      const { data: classLimits, error: classLimitsError } = await adminClient
        .from('class_performances')
        .select('id, class_name, max_tickets_per_user')
        .order('id');
      if (classLimitsError) {throw classLimitsError;}

      const activeTicketTypeIds: number[] = [];
      if (ticketIssueModes.classInvite !== 'off') {
        activeTicketTypeIds.push(1);
      }
      if (ticketIssueModes.rehearsalInvite !== 'off') {
        activeTicketTypeIds.push(2);
      }
      if (ticketIssueModes.gymInvite !== 'off') {
        activeTicketTypeIds.push(3);
      }
      if (ticketIssueModes.entryOnly !== 'off') {
        activeTicketTypeIds.push(4);
      }
      if (ticketIssueModes.sameDayClass !== 'off') {
        activeTicketTypeIds.push(8);
      }
      if (ticketIssueModes.sameDayGym !== 'off') {
        activeTicketTypeIds.push(9);
      }
      if (ticketIssueModes.juniorClass !== 'off') {
        activeTicketTypeIds.push(5);
      }
      if (ticketIssueModes.juniorGym !== 'off') {
        activeTicketTypeIds.push(6);
      }
      if (ticketIssueModes.juniorEntryOnly !== 'off') {
        activeTicketTypeIds.push(7);
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({
          settings: {
            eventYear: settings.event_year,
            showLength: settings.show_length,
            maxTicketsPerOtherClassUser: settings.max_tickets_per_other_class_user,
            maxTicketsPerOtherPerformanceUser: settings.max_tickets_per_other_performance_user,
            classTicketLimits: classLimits ?? [],
            maxTicketsPerOtherClubUser: settings.max_tickets_per_other_club_user,
            gymTicketLimitsByClub: settings.gym_ticket_limits_by_club ?? {},
            maxTicketsPerJuniorUser: settings.max_tickets_per_junior_user,
            maxAdmissionOnlyJuniorAccounts:
              settings.max_admission_only_junior_accounts,
            juniorReleaseOpen: settings.junior_release_open,
            ticketIssuingEnabled: settings.is_active,
            defaultClassTotalCapacity: maxCapacities.maxClassTotal ?? 0,
            defaultClassJuniorCapacity: maxCapacities.maxClassJunior ?? 0,
            defaultGymCapacity: maxCapacities.maxGym ?? 0,
            defaultGymJuniorCapacity: maxCapacities.maxGymJunior ?? 0,
            activeTicketTypeIds,
            ticketIssueModes,
          },
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    if (body.mode === 'updateSettings') {
      const session = await requireValidSession(adminClient, req);
      const currentSettings = await fetchAdminSettings(adminClient);

      const { error: updateError } = await adminClient
        .from('configs')
        .update({
          event_year: body.eventYear,
          show_length: body.showLength,
          max_tickets_per_other_class_user: body.maxTicketsPerOtherClassUser,
          max_tickets_per_other_performance_user: body.maxTicketsPerOtherPerformanceUser,
          max_tickets_per_other_club_user: body.maxTicketsPerOtherClubUser,
          gym_ticket_limits_by_club: body.gymTicketLimitsByClub,
          max_tickets_per_junior_user: body.maxTicketsPerJuniorUser,
          max_admission_only_junior_accounts:
            body.maxAdmissionOnlyJuniorAccounts,
          junior_release_open: body.juniorReleaseOpen,
          is_active: body.ticketIssuingEnabled,
        })
        .eq('id', currentSettings.id);

      if (updateError) {
        throw updateError;
      }

      // 全クラス公演のキャパシティを一括更新
      const { error: classUpdateError } = await adminClient
        .from('class_performances')
        .update({
          total_capacity: body.defaultClassTotalCapacity,
          junior_capacity: body.defaultClassJuniorCapacity,
        })
        .neq('id', 0);

      if (classUpdateError) {
        throw classUpdateError;
      }
      for (const [id, limit] of Object.entries(body.classTicketLimitsById)) {
        const { error } = await adminClient
          .from('class_performances')
          .update({ max_tickets_per_user: limit })
          .eq('id', Number(id));
        if (error) {throw error;}
      }

      // 全体育館公演のキャパシティを一括更新
      const { error: gymUpdateError } = await adminClient
        .from('gym_performances')
        .update({
          capacity: body.defaultGymCapacity,
          junior_capacity: body.defaultGymJuniorCapacity,
        })
        .neq('id', 0);

      if (gymUpdateError) {
        throw gymUpdateError;
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({
          updated: true,
          settings: {
            eventYear: body.eventYear,
            showLength: body.showLength,
            maxTicketsPerOtherClassUser: body.maxTicketsPerOtherClassUser,
            maxTicketsPerOtherPerformanceUser: body.maxTicketsPerOtherPerformanceUser,
            classTicketLimitsById: body.classTicketLimitsById,
            maxTicketsPerOtherClubUser: body.maxTicketsPerOtherClubUser,
            gymTicketLimitsByClub: body.gymTicketLimitsByClub,
            maxTicketsPerJuniorUser: body.maxTicketsPerJuniorUser,
            maxAdmissionOnlyJuniorAccounts: body.maxAdmissionOnlyJuniorAccounts,
            juniorReleaseOpen: body.juniorReleaseOpen,
            ticketIssuingEnabled: body.ticketIssuingEnabled,
            defaultClassTotalCapacity: body.defaultClassTotalCapacity,
            defaultClassJuniorCapacity: body.defaultClassJuniorCapacity,
            defaultGymCapacity: body.defaultGymCapacity,
          },
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    if (body.mode === 'updateTicketTypeSettings') {
      const session = await requireValidSession(adminClient, req);

      const { error: ticketIssueModeUpdateError } = await adminClient
        .from('ticket_issue_controls')
        .upsert(
          {
            id: 1,
            class_invite_mode: body.ticketIssueModes.classInvite,
            rehearsal_invite_mode: body.ticketIssueModes.rehearsalInvite,
            gym_invite_mode: body.ticketIssueModes.gymInvite,
            entry_only_mode: body.ticketIssueModes.entryOnly,
            same_day_class_mode: body.ticketIssueModes.sameDayClass,
            same_day_gym_mode: body.ticketIssueModes.sameDayGym,
            junior_class_mode: body.ticketIssueModes.juniorClass,
            junior_gym_mode: body.ticketIssueModes.juniorGym,
            junior_entry_only_mode: body.ticketIssueModes.juniorEntryOnly,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        );

      if (ticketIssueModeUpdateError) {
        throw ticketIssueModeUpdateError;
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({
          updated: true,
          activeTicketTypeIds: body.activeTicketTypeIds,
          ticketIssueModes: body.ticketIssueModes,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    if (body.mode === 'updateAcceptingStatus') {
      const session = await requireValidSession(adminClient, req);

      const { error: updateError } = await adminClient
        .from(body.table)
        .update({ [body.column]: body.value })
        .eq('id', body.recordId);

      if (updateError) {
        throw updateError;
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'updatePerformanceSchedule') {
      const session = await requireValidSession(adminClient, req);
      const { data: existingSchedule, error: existingScheduleError } =
        await adminClient
          .from('performances_schedule')
          .select('start_at')
          .eq('id', body.id)
          .maybeSingle();

      if (existingScheduleError) {
        throw existingScheduleError;
      }
      if (!existingSchedule) {
        throw new HttpError(404, '公演回が見つかりません。');
      }

      const { data: schedule, error } = await adminClient
        .from('performances_schedule')
        .update({
          round_name: body.roundName,
          start_at: body.startAt,
          is_active: body.isActive,
        })
        .eq('id', body.id)
        .select('id, round_name, start_at, is_active')
        .maybeSingle();

      if (error) {
        throw error;
      }
      if (!schedule) {
        throw new HttpError(404, '公演回が見つかりません。');
      }

      const startTimeChanged =
        Date.parse(existingSchedule.start_at) !== Date.parse(body.startAt);
      let redeployTriggered = false;
      let redeployError: string | undefined;
      if (startTimeChanged) {
        try {
          await triggerCloudflarePagesDeploy();
          redeployTriggered = true;
        } catch (error) {
          redeployError =
            error instanceof Error ? error.message : '不明なエラーが発生しました。';
        }
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(JSON.stringify({
        updated: true,
        schedule,
        redeployTriggered,
        redeployError,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'getOrganizationAdmins') {
      const session = await requireValidSession(adminClient, req);
      const [adminsResult, classesResult, gymsResult, exhibitionsResult] = await Promise.all([
        adminClient
          .from('organization_admins')
          .select('id, username, class_performance_id, gym_performance_id, exhibition_club_id, created_at')
          .order('username'),
        adminClient.from('class_performances').select('id, class_name, title').order('id'),
        adminClient
          .from('gym_performances')
          .select('id, group_name, round_name')
          .order('start_at'),
        adminClient.from('exhibition_clubs').select('id, group_name').order('id'),
      ]);
      const failed = [adminsResult, classesResult, gymsResult, exhibitionsResult].find(
        (result) => result.error,
      );
      if (failed?.error) {
        throw failed.error;
      }
      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);
      return new Response(
        JSON.stringify({
          admins: adminsResult.data ?? [],
          classes: classesResult.data ?? [],
          gyms: gymsResult.data ?? [],
          exhibitions: exhibitionsResult.data ?? [],
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (body.mode === 'getClassPerformances') {
      const session = await requireValidSession(adminClient, req);
      const settings = await fetchAdminSettings(adminClient);
      const [classResult, gymResult, exhibitionResult] = await Promise.all([
        adminClient
        .from('class_performances')
        .select('id, year, class_name, title, description, image_path, total_capacity, junior_capacity, is_accepting')
        .order('class_name'),
        adminClient.from('gym_performances').select('id, year, group_name, round_name, start_at, end_at, description, image_path, capacity, junior_capacity, is_accepting').order('start_at'),
        adminClient.from('exhibition_clubs').select('id, group_name, description, image_path').order('id'),
      ]);
      const error = classResult.error ?? gymResult.error ?? exhibitionResult.error;
      if (error) {
        throw error;
      }
      const performances = [
        ...(classResult.data ?? []).map((item) => ({ ...item, performance_type: 'class' })),
        ...(gymResult.data ?? []).map((item) => ({ id: item.id, year: item.year, class_name: item.group_name, title: item.round_name, start_at: item.start_at, end_at: item.end_at, description: item.description, image_path: item.image_path, total_capacity: item.capacity, junior_capacity: item.junior_capacity, is_accepting: item.is_accepting, performance_type: 'gym' })),
        ...(exhibitionResult.data ?? []).map((item) => ({ id: item.id, year: null, class_name: item.group_name, title: '', description: item.description, image_path: item.image_path, total_capacity: null, junior_capacity: null, is_accepting: null, performance_type: 'exhibition' })),
      ];
      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);
      return new Response(JSON.stringify({
        performances: performances ?? [],
        eventYear: settings.event_year,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'updateClassPerformance') {
      const session = await requireValidSession(adminClient, req);
      const settings = await fetchAdminSettings(adminClient);
      const table = body.performanceType === 'class' ? 'class_performances' : body.performanceType === 'gym' ? 'gym_performances' : 'exhibition_clubs';
      const update = body.performanceType === 'class' ? {
          year: settings.event_year,
          class_name: body.className,
          title: body.title,
          description: body.description,
          total_capacity: body.totalCapacity,
          junior_capacity: body.juniorCapacity,
          is_accepting: body.isAccepting,
        } : body.performanceType === 'gym' ? {
          year: settings.event_year, group_name: body.className, round_name: body.title,
          description: body.description, capacity: body.totalCapacity,
          junior_capacity: body.juniorCapacity, is_accepting: body.isAccepting,
          start_at: body.startAt, end_at: body.endAt,
        } : { group_name: body.className, description: body.description };
      const { data: rawPerformance, error } = await adminClient
        .from(table)
        .update(update)
        .eq('id', body.id)
        .select('*')
        .maybeSingle();
      if (error) {
        if (error.code === '23505') {
          throw new HttpError(400, '同じクラス名の公演が既にあります。');
        }
        throw error;
      }
      if (!rawPerformance) {
        throw new HttpError(404, 'クラス公演が見つかりません。');
      }
      const item = rawPerformance as Record<string, unknown>;
  const performance = body.performanceType === 'class' ? { ...rawPerformance, performance_type: 'class' } : {
    id: item.id, year: body.performanceType === 'gym' ? item.year : null,
    class_name: item.group_name, title: body.performanceType === 'gym' ? item.round_name : '',
    start_at: body.performanceType === 'gym' ? item.start_at : null,
    end_at: body.performanceType === 'gym' ? item.end_at : null,
    description: item.description, image_path: item.image_path,
        total_capacity: body.performanceType === 'gym' ? item.capacity : null,
        junior_capacity: body.performanceType === 'gym' ? item.junior_capacity : null,
        is_accepting: body.performanceType === 'gym' ? item.is_accepting : null,
        performance_type: body.performanceType,
      };
      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);
      return new Response(JSON.stringify({
        updated: true,
        performance,
        eventYear: settings.event_year,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'uploadClassPerformanceImage') {
      const session = await requireValidSession(adminClient, req);
      const table = body.performanceType === 'class' ? 'class_performances' : body.performanceType === 'gym' ? 'gym_performances' : 'exhibition_clubs';
      const { data: existingPerformance, error: findError } = await adminClient
        .from(table)
        .select('id')
        .eq('id', body.id)
        .maybeSingle();
      if (findError) {
        throw findError;
      }
      if (!existingPerformance) {
        throw new HttpError(404, 'クラス公演が見つかりません。');
      }
      const extension = body.contentType === 'image/jpeg'
        ? 'jpg'
        : body.contentType === 'image/png' ? 'png' : 'webp';
      let bytes: Uint8Array;
      try {
        const binary = atob(body.base64);
        bytes = Uint8Array.from(
          binary,
          (character) => character.charCodeAt(0),
        );
      } catch {
        throw new HttpError(400, '画像データが不正です。');
      }
      if (bytes.byteLength > 5 * 1024 * 1024) {
        throw new HttpError(400, '画像ファイルは5MB以下にしてください。');
      }
      const path = `admin/${body.performanceType}-${body.id}.${extension}`;
      const { error: uploadError } = await adminClient.storage
        .from('performance-images')
        .upload(path, bytes, {
          contentType: body.contentType,
          upsert: true,
          cacheControl: '3600',
        });
      if (uploadError) {
        throw uploadError;
      }
      const settings = await fetchAdminSettings(adminClient);
      const { data: rawPerformance, error: updateError } = await adminClient
        .from(table)
        .update(body.performanceType === 'exhibition' ? { image_path: path } : { image_path: path, year: settings.event_year })
        .eq('id', body.id)
        .select('*')
        .maybeSingle();
      if (updateError) {
        throw updateError;
      }
      if (!rawPerformance) {
        throw new HttpError(404, 'クラス公演が見つかりません。');
      }
      const item = rawPerformance as Record<string, unknown>;
  const performance = body.performanceType === 'class' ? { ...rawPerformance, performance_type: 'class' } : {
    id: item.id, year: body.performanceType === 'gym' ? item.year : null,
    class_name: item.group_name, title: body.performanceType === 'gym' ? item.round_name : '',
    start_at: body.performanceType === 'gym' ? item.start_at : null,
    end_at: body.performanceType === 'gym' ? item.end_at : null,
    description: item.description, image_path: item.image_path,
        total_capacity: body.performanceType === 'gym' ? item.capacity : null,
        junior_capacity: body.performanceType === 'gym' ? item.junior_capacity : null,
        is_accepting: body.performanceType === 'gym' ? item.is_accepting : null,
        performance_type: body.performanceType,
      };
      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);
      return new Response(JSON.stringify({
        updated: true,
        performance,
        eventYear: settings.event_year,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'createOrganizationAdmin') {
      const session = await requireValidSession(adminClient, req);
      const performanceTable = body.kind === 'class'
        ? 'class_performances'
        : body.kind === 'gym' ? 'gym_performances' : 'exhibition_clubs';
      const { data: performance, error: performanceError } = await adminClient
        .from(performanceTable)
        .select('id')
        .eq('id', body.performanceId)
        .maybeSingle();
      if (performanceError) {
        throw performanceError;
      }
      if (!performance) {
        throw new HttpError(404, '対象の公演が見つかりません。');
      }
      if (body.kind === 'gym') {
        const { data: targetGym, error: targetGymError } = await adminClient
          .from('gym_performances')
          .select('group_name')
          .eq('id', body.performanceId)
          .single();
        if (targetGymError) {
          throw targetGymError;
        }
        const { data: groupPerformances, error: groupError } = await adminClient
          .from('gym_performances')
          .select('id')
          .eq('group_name', targetGym.group_name);
        if (groupError) {
          throw groupError;
        }
        const groupIds = (groupPerformances ?? []).map((item) => item.id);
        const { data: existingGroupAdmin, error: existingError } =
          await adminClient
            .from('organization_admins')
            .select('id')
            .in('gym_performance_id', groupIds)
            .limit(1);
        if (existingError) {
          throw existingError;
        }
        if (existingGroupAdmin && existingGroupAdmin.length > 0) {
          throw new HttpError(
            409,
            'この部活には既に管理者アカウントが作成されています。',
          );
        }
      }
      if (body.kind === 'exhibition') {
        const { data: existingExhibitionAdmin, error: existingError } =
          await adminClient
            .from('organization_admins')
            .select('id')
            .eq('exhibition_club_id', body.performanceId)
            .limit(1);
        if (existingError) {
          throw existingError;
        }
        if (existingExhibitionAdmin && existingExhibitionAdmin.length > 0) {
          throw new HttpError(
            409,
            'この展示部活には既に管理者アカウントが作成されています。',
          );
        }
      }
      const { error: insertError } = await adminClient
        .from('organization_admins')
        .insert({
          username: body.username,
          password_hash: await hash(body.password, 12),
          class_performance_id:
            body.kind === 'class' ? body.performanceId : null,
          gym_performance_id: body.kind === 'gym' ? body.performanceId : null,
          exhibition_club_id: body.kind === 'exhibition' ? body.performanceId : null,
        });
      if (insertError) {
        if (insertError.code === '23505') {
          throw new HttpError(400, '同じユーザー名は登録できません。');
        }
        throw insertError;
      }
      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);
      return new Response(JSON.stringify({ created: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'changeOrganizationAdminPassword') {
      const session = await requireValidSession(adminClient, req);
      const { data: account, error: accountError } = await adminClient
        .from('organization_admins')
        .select('id')
        .eq('id', body.organizationAdminId)
        .maybeSingle();
      if (accountError) {
        throw accountError;
      }
      if (!account) {
        throw new HttpError(404, '団体管理者アカウントが見つかりません。');
      }
      const { error: updateError } = await adminClient
        .from('organization_admins')
        .update({
          password_hash: await hash(body.password, 12),
          updated_at: new Date().toISOString(),
        })
        .eq('id', body.organizationAdminId);
      if (updateError) {
        throw updateError;
      }
      await adminClient
        .from('organization_admin_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('organization_admin_id', body.organizationAdminId)
        .is('revoked_at', null);
      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);
      return new Response(JSON.stringify({ changed: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'changeOrganizationAdminUsername') {
      const session = await requireValidSession(adminClient, req);
      const { error } = await adminClient
        .from('organization_admins')
        .update({ username: body.username, updated_at: new Date().toISOString() })
        .eq('id', body.organizationAdminId);
      if (error) {
        if (error.code === '23505') {throw new HttpError(400, '同じユーザー名は登録できません。');}
        throw error;
      }
      await adminClient.from('organization_admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('organization_admin_id', body.organizationAdminId).is('revoked_at', null);
      await adminClient.from('admin_sessions').update({ last_used_at: new Date().toISOString() }).eq('id', session.id);
      return new Response(JSON.stringify({ changed: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (body.mode === 'deleteOrganizationAdmin') {
      const session = await requireValidSession(adminClient, req);
      const { error, count } = await adminClient
        .from('organization_admins')
        .delete({ count: 'exact' })
        .eq('id', body.organizationAdminId);
      if (error) {
        throw error;
      }
      if (!count) {
        throw new HttpError(404, '団体管理者アカウントが見つかりません。');
      }
      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);
      return new Response(JSON.stringify({ deleted: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'deleteAllOrganizationAdmins') {
      const session = await requireValidSession(adminClient, req);
      const { error, count } = await adminClient
        .from('organization_admins')
        .delete({ count: 'exact' })
        .neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) {
        throw error;
      }
      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);
      return new Response(JSON.stringify({ deleted: true, count: count ?? 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'bulkCreateOrganizationAdmins') {
      const session = await requireValidSession(adminClient, req);
      const { data: existing, error: existingError } = await adminClient
        .from('organization_admins')
        .select('username, class_performance_id, gym_performance_id, exhibition_club_id');
      if (existingError) {throw existingError;}
      const usedUsernames = new Set((existing ?? []).map((item) => item.username));
      const assigned = new Set((existing ?? []).map((item) => item.class_performance_id ? `class:${item.class_performance_id}` : item.gym_performance_id ? `gym:${item.gym_performance_id}` : `exhibition:${item.exhibition_club_id}`));
      const { data: gymPerformances, error: gymError } = await adminClient
        .from('gym_performances')
        .select('id, group_name');
      if (gymError) {throw gymError;}
      const gymGroups = new Map(
        (gymPerformances ?? []).map((item) => [item.id, item.group_name]),
      );
      const assignedGymGroups = new Set(
        (existing ?? [])
          .map((item) =>
            item.gym_performance_id
              ? gymGroups.get(item.gym_performance_id)
              : null,
          )
          .filter((group): group is string => Boolean(group)),
      );
      const rows: { username: string; password_hash: string; class_performance_id: number | null; gym_performance_id: number | null; exhibition_club_id: number | null }[] = [];
      const skipped: string[] = [];
      for (const item of body.admins) {
        const key = `${item.kind}:${item.performanceId}`;
        const gymGroup =
          item.kind === 'gym' ? gymGroups.get(item.performanceId) : null;
        if (
          usedUsernames.has(item.username) ||
          assigned.has(key) ||
          (typeof gymGroup === 'string' && assignedGymGroups.has(gymGroup))
        ) {
          skipped.push(item.username);
          continue;
        }
        rows.push({ username: item.username, password_hash: await hash(item.password, 10), class_performance_id: item.kind === 'class' ? item.performanceId : null, gym_performance_id: item.kind === 'gym' ? item.performanceId : null, exhibition_club_id: item.kind === 'exhibition' ? item.performanceId : null });
        usedUsernames.add(item.username);
        assigned.add(key);
        if (typeof gymGroup === 'string') {assignedGymGroups.add(gymGroup);}
      }
      if (rows.length > 0) {
        const { error } = await adminClient.from('organization_admins').insert(rows);
        if (error) {throw error;}
      }
      await adminClient.from('admin_sessions').update({ last_used_at: new Date().toISOString() }).eq('id', session.id);
      return new Response(JSON.stringify({ created: rows.length, skipped }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (body.mode === 'getJuniorPassword') {
      const session = await requireValidSession(adminClient, req);

      const { data: configData, error: configError } = await adminClient
        .from('configs')
        .select('junior_password')
        .single();

      if (configError) {
        throw new HttpError(500, '合言葉の取得に失敗しました。');
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({
          hasPassword:
            configData.junior_password !== null &&
            configData.junior_password !== '',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    if (body.mode === 'updateJuniorPassword') {
      const session = await requireValidSession(adminClient, req);

      // pgcryptoを使用してハッシュ化（RPC関数との互換性のため）
      const { data: hashData, error: hashError } = await adminClient.rpc(
        'hash_password',
        { p_password: body.juniorPassword },
      );

      if (hashError || !hashData) {
        throw new HttpError(500, '合言葉のハッシュ化に失敗しました。');
      }

      const { error: updateError } = await adminClient
        .from('configs')
        .update({ junior_password: hashData })
        .eq('id', 1);

      if (updateError) {
        throw new HttpError(500, '合言葉の更新に失敗しました。');
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(JSON.stringify({ updated: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'validateJuniorSecretCode') {
      // pgcryptoを使用して検証（RPC関数との互換性のため）
      const { data: isValid, error: validateError } = await adminClient.rpc(
        'validate_junior_secret_code',
        { p_secret_code: body.secretCode },
      );

      if (validateError) {
        throw new HttpError(
          500,
          '合言葉の検証に失敗しました。' + validateError.message,
        );
      }

      return new Response(JSON.stringify({ valid: isValid || false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const config = await fetchAdminConfig(adminClient);

    if (body.mode === 'changePassword') {
      const clientIp = getClientIp(req);
      const currentRateLimitRow = await getRateLimitRow(adminClient, clientIp);
      ensureIpIsNotLocked(currentRateLimitRow);

      const session = await requireValidSession(adminClient, req);

      const currentPasswordMatched = await compare(
        body.currentPassword,
        config.passwordHash,
      );
      if (!currentPasswordMatched) {
        const rateLimitResult = await registerFailedAttempt(
          adminClient,
          clientIp,
          currentRateLimitRow,
        );
        if (rateLimitResult.shouldLock && rateLimitResult.lockedUntil) {
          const retryAfterSeconds = getRemainingLockSeconds(
            rateLimitResult.lockedUntil,
          );
          throw new HttpError(
            429,
            `試行回数が上限に達しました。${retryAfterSeconds}秒後に再試行してください。`,
          );
        }

        throw new HttpError(401, '現在の管理者パスワードが正しくありません。');
      }

      await clearFailedLoginAttempts(adminClient, clientIp);

      const isSameAsCurrent = await compare(
        body.newPassword,
        config.passwordHash,
      );
      if (isSameAsCurrent) {
        throw new HttpError(
          400,
          '新しいパスワードは現在のパスワードと異なる値を指定してください。',
        );
      }

      const newPasswordHash = await hash(body.newPassword, 12);
      const { error: updateError } = await adminClient
        .from('configs')
        .update({ admin_password: newPasswordHash })
        .eq('id', config.id);

      if (updateError) {
        throw updateError;
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({
          changed: true,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    const clientIp = getClientIp(req);
    const currentRateLimitRow = await getRateLimitRow(adminClient, clientIp);
    ensureIpIsNotLocked(currentRateLimitRow);

    const authenticated = await compare(body.password, config.passwordHash);
    if (!authenticated) {
      const rateLimitResult = await registerFailedAttempt(
        adminClient,
        clientIp,
        currentRateLimitRow,
      );
      if (rateLimitResult.shouldLock && rateLimitResult.lockedUntil) {
        const retryAfterSeconds = getRemainingLockSeconds(
          rateLimitResult.lockedUntil,
        );
        throw new HttpError(
          429,
          `試行回数が上限に達しました。${retryAfterSeconds}秒後に再試行してください。`,
        );
      }

      return new Response(
        JSON.stringify({
          authenticated: false,
          remainingAttempts: rateLimitResult.remainingAttempts,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    await clearFailedLoginAttempts(adminClient, clientIp);

    const session = await createSession(adminClient);

    return new Response(
      JSON.stringify({
        authenticated: true,
        sessionToken: session.token,
        expiresAt: session.expiresAt,
        sessionDurationMs: ADMIN_CONTROL_PANEL_SESSION_DURATION_MS,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error) {
    console.error(error);

    const isHttpError = error instanceof HttpError;
    return new Response(
      JSON.stringify({
        error: isHttpError
          ? error.message
          : '認証に失敗しました。通信状況と設定を確認してください。',
      }),
      {
        status: isHttpError ? error.status : 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  }
});
