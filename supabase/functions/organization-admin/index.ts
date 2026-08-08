import '@supabase/functions-js/edge-runtime.d.ts';

import { compare, hash } from 'bcryptjs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getCorsHeaders } from '@shared/cors.ts';
import { getEnv } from '@shared/getEnv.ts';
import HttpError from '@shared/HttpError.ts';
import { triggerCloudflarePagesDeploy } from '@shared/triggerCloudflarePagesDeploy.ts';

const SESSION_DURATION_MS = 1000 * 60 * 60 * 8;
const SESSION_HEADER = 'x-organization-admin-session-token';

type Admin = {
  id: string;
  username: string;
  password_hash: string;
  class_performance_id: number | null;
  gym_performance_id: number | null;
  exhibition_club_id: number | null;
};

const json = (body: unknown, corsHeaders: HeadersInit, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const password = (value: unknown, name: string) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, `${name} を入力してください。`);
  }
  if (value.length > 256) {throw new HttpError(400, `${name} が長すぎます。`);}
  return value.trim();
};

const text = (value: unknown, name: string, max = 2000) => {
  if (typeof value !== 'string') {throw new HttpError(400, `${name} が不正です。`);}
  const normalized = value.trim();
  if (normalized.length > max) {throw new HttpError(400, `${name} が長すぎます。`);}
  return normalized;
};

const eventYear = async (client: SupabaseClient) => {
  const { data, error } = await client
    .from('configs')
    .select('event_year')
    .eq('id', 1)
    .maybeSingle();
  if (error) {throw error;}
  const year = data?.event_year;
  if (typeof year !== 'number' || !Number.isInteger(year)) {
    throw new HttpError(500, '開催年度の設定を取得できませんでした。');
  }
  return year;
};

const tokenHash = async (token: string) => {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
};

const token = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `org_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

const sessionToken = (req: Request) => {
  const value = req.headers.get(SESSION_HEADER)?.trim() ?? '';
  if (!value || value.length > 512) {
    throw new HttpError(401, 'セッションが無効です。再ログインしてください。');
  }
  return value;
};

const requireAdmin = async (client: SupabaseClient, req: Request) => {
  const hashed = await tokenHash(sessionToken(req));
  const { data, error } = await client
    .from('organization_admin_sessions')
    .select('id, organization_admin_id, expires_at, organization_admins(id, username, password_hash, class_performance_id, gym_performance_id, exhibition_club_id)')
    .eq('token_hash', hashed)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) {throw error;}
  const admin = data?.organization_admins as unknown as Admin | null;
  if (!data || !admin) {throw new HttpError(401, 'セッションが無効です。再ログインしてください。');}
  await client.from('organization_admin_sessions').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  return admin;
};

const ownPerformance = async (client: SupabaseClient, admin: Admin) => {
  if (admin.class_performance_id) {
    const { data, error } = await client.from('class_performances')
      .select('id, class_name, title, description, image_path, is_accepting, total_capacity, junior_capacity, max_tickets_per_user')
      .eq('id', admin.class_performance_id).maybeSingle();
    if (error) {throw error;}
    if (!data) {throw new HttpError(404, '担当公演が見つかりません。');}
    return { kind: 'class' as const, performance: data };
  }
  if (admin.exhibition_club_id) {
    const { data, error } = await client.from('exhibition_clubs')
      .select('id, group_name, description, image_path')
      .eq('id', admin.exhibition_club_id).maybeSingle();
    if (error) {throw error;}
    if (!data) {throw new HttpError(404, '担当展示部活が見つかりません。');}
    return { kind: 'exhibition' as const, performance: data };
  }
  const { data, error } = await client.from('gym_performances')
    .select('id, group_name, round_name, description, image_path, start_at, end_at, is_accepting, capacity, junior_capacity')
    .eq('id', admin.gym_performance_id).maybeSingle();
  if (error) {throw error;}
  if (!data) {throw new HttpError(404, '担当公演が見つかりません。');}
  const { data: groupPerformances, error: groupError } = await client
    .from('gym_performances')
    .select('id, group_name, round_name, description, image_path, start_at, end_at, is_accepting, capacity, junior_capacity')
    .eq('group_name', data.group_name)
    .order('start_at');
  if (groupError) {throw groupError;}
  return {
    kind: 'gym' as const,
    performance: data,
    performances: groupPerformances ?? [data],
  };
};

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {return new Response('ok', { headers: corsHeaders });}
  if (req.method !== 'POST') {return json({ error: 'Method not allowed' }, corsHeaders, 405);}
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = body.action;
    const client = createClient(getEnv('SUPABASE_URL'), getEnv('FOR_ADMIN_SUPABASE_SECRET_KEY'), {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (action === 'login') {
      const username = text(body.username, 'ユーザー名', 100);
      const submittedPassword = password(body.password, 'パスワード');
      const { data, error } = await client.from('organization_admins')
        .select('id, username, password_hash, class_performance_id, gym_performance_id, exhibition_club_id')
        .eq('username', username).maybeSingle();
      if (error) {throw error;}
      const admin = data as Admin | null;
      if (!admin || !(await compare(submittedPassword, admin.password_hash))) {
        return json({ authenticated: false }, corsHeaders);
      }
      const rawToken = token();
      const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
      const { error: insertError } = await client.from('organization_admin_sessions').insert({
        organization_admin_id: admin.id, token_hash: await tokenHash(rawToken), expires_at: expiresAt,
      });
      if (insertError) {throw insertError;}
      return json({ authenticated: true, sessionToken: rawToken, expiresAt }, corsHeaders);
    }

    if (action === 'verify') {
      try { await requireAdmin(client, req); return json({ authenticated: true }, corsHeaders); }
      catch (error) { if (error instanceof HttpError) {return json({ authenticated: false }, corsHeaders);} throw error; }
    }

    if (action === 'logout') {
      const hashed = await tokenHash(sessionToken(req));
      await client.from('organization_admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('token_hash', hashed);
      return json({ loggedOut: true }, corsHeaders);
    }

    const admin = await requireAdmin(client, req);
    if (action === 'triggerRedeploy') {
      await triggerCloudflarePagesDeploy();
      return json({ redeployTriggered: true }, corsHeaders);
    }
    if (action === 'getDashboard') {
      const own = await ownPerformance(client, admin);
      if (own.kind === 'exhibition') {
        return json({
          username: admin.username,
          performance: own.performance,
          performances: [own.performance],
          kind: own.kind,
          rounds: [],
          relationships: [],
          tickets: [],
        }, corsHeaders);
      }
      const ticketQuery = own.kind === 'class'
        ? client.from('class_tickets').select('id, round_id, tickets!inner(id, code, created_at, relationship, ticket_type, users(affiliation))').eq('class_id', own.performance.id).eq('tickets.status', 'valid')
        : client.from('gym_tickets').select('id, performance_id, tickets!inner(id, code, created_at, relationship, ticket_type, users(affiliation))').in('performance_id', own.performances.map((performance) => performance.id)).eq('tickets.status', 'valid');
      const { data: ticketLinks, error } = await ticketQuery;
      if (error) {throw error;}
      const { data: relationships, error: relationshipsError } = await client
        .from('relationships')
        .select('id, name');
      if (relationshipsError) {throw relationshipsError;}
      const generalTickets = ((ticketLinks ?? []) as Array<{
        id: string;
        round_id?: number;
        tickets: unknown;
      }>).filter((link) => {
        const ticket = link.tickets as unknown as { ticket_type?: number } | null;
        return ticket?.ticket_type !== 5 && ticket?.ticket_type !== 6;
      });
      if (own.kind === 'gym') {
        const { data: config, error: configError } = await client
          .from('configs')
          .select('max_tickets_per_other_club_user, gym_ticket_limits_by_club')
          .order('id')
          .limit(1)
          .maybeSingle();
        if (configError) {throw configError;}
        const limitsByClub = config?.gym_ticket_limits_by_club &&
          typeof config.gym_ticket_limits_by_club === 'object' &&
          !Array.isArray(config.gym_ticket_limits_by_club)
          ? config.gym_ticket_limits_by_club as Record<string, unknown>
          : {};
        const configuredLimit = Number(limitsByClub[own.performance.group_name]);
        const gymTicketLimit = Number.isInteger(configuredLimit) && configuredLimit >= 0
          ? configuredLimit
          : Number(config?.max_tickets_per_other_club_user ?? 0);
        const roundNames = new Map(
          own.performances.map((performance) => [
            performance.id,
            performance.round_name,
          ]),
        );
        return json({
          username: admin.username,
          performance: own.performance,
          performances: own.performances,
          kind: own.kind,
          rounds: own.performances.map((performance) => ({
            id: performance.id,
            name: performance.round_name,
          })),
          relationships: relationships ?? [],
          gymTicketLimit,
          tickets: generalTickets.map((link) => ({
            ...link,
            round_id: (link as { performance_id?: number }).performance_id,
            round_name: roundNames.get((link as { performance_id?: number }).performance_id) ?? '未設定',
          })),
        }, corsHeaders);
      }
      const { data: schedules, error: scheduleError } = await client
        .from('performances_schedule')
        .select('id, round_name')
        .order('start_at');
      if (scheduleError) {throw scheduleError;}
      const roundNames = new Map((schedules ?? []).map((schedule) => [schedule.id, schedule.round_name]));
      return json({
        username: admin.username,
        performance: own.performance,
        performances: [own.performance],
        kind: own.kind,
        rounds: (schedules ?? []).map((schedule) => ({
          id: schedule.id,
          name: schedule.round_name,
        })),
        relationships: relationships ?? [],
        tickets: generalTickets.map((link) => ({
          ...link,
          round_name: roundNames.get(link.round_id) ?? '未設定',
        })),
      }, corsHeaders);
    }

    if (action === 'updatePerformance') {
      const own = await ownPerformance(client, admin);
      const description = text(body.description, '公演説明');
      const year = await eventYear(client);
      if (own.kind === 'exhibition') {
        const { error } = await client.from('exhibition_clubs')
          .update({ description, year, updated_at: new Date().toISOString() })
          .eq('id', own.performance.id);
        if (error) {throw error;}
        return json({ updated: true }, corsHeaders);
      }
      const isAccepting = body.isAccepting;
      if (typeof isAccepting !== 'boolean') {throw new HttpError(400, '受付状態が不正です。');}
      if (own.kind === 'class') {
        const title = text(body.title, '公演タイトル', 200);
        const { error } = await client.from('class_performances').update({ title, description, is_accepting: isAccepting, year }).eq('id', own.performance.id);
        if (error) {throw error;}
      } else {
        if (!Array.isArray(body.scheduleTimes)) {
          const { error } = await client.from('gym_performances').update({ description, is_accepting: isAccepting, year }).in('id', own.performances.map((performance) => performance.id));
          if (error) {throw error;}
        } else {
          const scheduleTimes = new Map<number, { startAt: string; endAt: string }>();
          for (const item of body.scheduleTimes) {
            if (
              !item ||
              typeof item !== 'object' ||
              !Number.isInteger((item as { id?: unknown }).id) ||
              typeof (item as { startAt?: unknown }).startAt !== 'string' ||
              typeof (item as { endAt?: unknown }).endAt !== 'string'
            ) {
              throw new HttpError(400, '公演時間の指定が不正です。');
            }
            const schedule = item as { id: number; startAt: string; endAt: string };
            if (scheduleTimes.has(schedule.id)) {
              throw new HttpError(400, '公演時間の指定が重複しています。');
            }
            const startAt = new Date(schedule.startAt);
            const endAt = new Date(schedule.endAt);
            if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || startAt >= endAt) {
              throw new HttpError(400, '終了時刻は開始時刻より後に設定してください。');
            }
            scheduleTimes.set(schedule.id, {
              startAt: startAt.toISOString(),
              endAt: endAt.toISOString(),
            });
          }
          if (scheduleTimes.size !== own.performances.length) {
            throw new HttpError(400, 'すべての公演回の時間を指定してください。');
          }
          for (const performance of own.performances) {
            const schedule = scheduleTimes.get(performance.id);
            if (!schedule) {
              throw new HttpError(400, '対象外の公演回が含まれています。');
            }
            const { error } = await client.from('gym_performances')
              .update({
                description,
                is_accepting: isAccepting,
                year,
                start_at: schedule.startAt,
                end_at: schedule.endAt,
              })
              .eq('id', performance.id);
            if (error) {throw error;}
          }
        }
      }
      return json({ updated: true }, corsHeaders);
    }

    if (action === 'updateTicketSettings') {
      const own = await ownPerformance(client, admin);
      if (own.kind === 'exhibition') {
        throw new HttpError(400, '展示部活ではチケット設定を変更できません。');
      }
      const isAccepting = body.isAccepting;
      const capacity = body.capacity;
      const juniorCapacity = body.juniorCapacity;
      const maxTicketsPerUser = body.maxTicketsPerUser;
      if (typeof isAccepting !== 'boolean') {throw new HttpError(400, '受付状態が不正です。');}
      if (!Number.isInteger(capacity) || typeof capacity !== 'number' || capacity < 1 || capacity > 10000) {
        throw new HttpError(400, '定員は1〜10,000人の整数で指定してください。');
      }
      if (!Number.isInteger(juniorCapacity) || typeof juniorCapacity !== 'number' || juniorCapacity < 0 || juniorCapacity > capacity) {
        throw new HttpError(400, '中学生枠は0〜定員の範囲で指定してください。');
      }
      if (own.kind === 'class' && (!Number.isInteger(maxTicketsPerUser) || typeof maxTicketsPerUser !== 'number' || maxTicketsPerUser < 0 || maxTicketsPerUser > 100)) {
        throw new HttpError(400, '自クラスの発行可能枚数は0〜100の整数で指定してください。');
      }
      const ticketQuery = own.kind === 'class'
        ? client.from('class_tickets').select('tickets!inner(person_count)').eq('class_id', own.performance.id).eq('tickets.status', 'valid')
        : client.from('gym_tickets').select('tickets!inner(person_count)').in('performance_id', own.performances.map((performance) => performance.id)).eq('tickets.status', 'valid');
      const { data: ticketLinks, error: ticketError } = await ticketQuery;
      if (ticketError) {throw ticketError;}
      const issuedCount = (ticketLinks ?? []).reduce((total, item) => {
        const ticket = item.tickets as unknown as { person_count?: number } | null;
        return total + (ticket?.person_count ?? 0);
      }, 0);
      if (capacity < issuedCount) {
        throw new HttpError(400, `現在${issuedCount}人分の有効チケットがあるため、それ未満には変更できません。`);
      }
      const year = await eventYear(client);
      const update = own.kind === 'class'
        ? { total_capacity: capacity, junior_capacity: juniorCapacity, max_tickets_per_user: maxTicketsPerUser, is_accepting: isAccepting, year }
        : { capacity, junior_capacity: juniorCapacity, is_accepting: isAccepting, year };
      const updateQuery = client
        .from(own.kind === 'class' ? 'class_performances' : 'gym_performances')
        .update(update);
      const { error } = own.kind === 'class'
        ? await updateQuery.eq('id', own.performance.id)
        : await updateQuery.in('id', own.performances.map((performance) => performance.id));
      if (error) {throw error;}
      return json({ updated: true }, corsHeaders);
    }

    if (action === 'updateGymTicketLimit') {
      const own = await ownPerformance(client, admin);
      if (own.kind !== 'gym') {
        throw new HttpError(403, '体育館公演の部活管理者のみ変更できます。');
      }
      const limit = body.limit;
      if (!Number.isInteger(limit) || typeof limit !== 'number' || limit < 0 || limit > 100) {
        throw new HttpError(400, '発行上限数は0〜100の範囲の整数で指定してください。');
      }
      const { data: config, error: configError } = await client
        .from('configs')
        .select('id, gym_ticket_limits_by_club')
        .order('id')
        .limit(1)
        .maybeSingle();
      if (configError) {throw configError;}
      if (!config) {throw new HttpError(500, '発行上限設定が見つかりません。');}
      const limitsByClub = config.gym_ticket_limits_by_club &&
        typeof config.gym_ticket_limits_by_club === 'object' &&
        !Array.isArray(config.gym_ticket_limits_by_club)
        ? config.gym_ticket_limits_by_club as Record<string, unknown>
        : {};
      const { error } = await client
        .from('configs')
        .update({ gym_ticket_limits_by_club: { ...limitsByClub, [own.performance.group_name]: limit } })
        .eq('id', config.id);
      if (error) {throw error;}
      return json({ updated: true, gymTicketLimit: limit }, corsHeaders);
    }

    if (action === 'uploadImage') {
      const own = await ownPerformance(client, admin);
      const contentType = body.contentType;
      const base64 = body.base64;
      if (
        contentType !== 'image/jpeg' &&
        contentType !== 'image/png' &&
        contentType !== 'image/webp'
      ) {
        throw new HttpError(400, 'JPEG・PNG・WebP画像のみアップロードできます。');
      }
      if (typeof base64 !== 'string' || base64.length === 0) {
        throw new HttpError(400, '画像データが不正です。');
      }
      if (base64.length > 7_000_000) {
        throw new HttpError(400, '画像ファイルは5MB以下にしてください。');
      }
      const extension = contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/png' ? 'png' : 'webp';
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      if (bytes.byteLength > 5 * 1024 * 1024) {
        throw new HttpError(400, '画像ファイルは5MB以下にしてください。');
      }
      const path = `organization/${own.kind}-${own.performance.id}.${extension}`;
      const { error: uploadError } = await client.storage
        .from('performance-images')
        .upload(path, bytes, { contentType, upsert: true, cacheControl: '3600' });
      if (uploadError) {
        throw uploadError;
      }
      const year = await eventYear(client);
      const imageUpdateQuery = client
        .from(own.kind === 'class' ? 'class_performances' : own.kind === 'gym' ? 'gym_performances' : 'exhibition_clubs')
        .update({ image_path: path, year });
      const { error: updateError } = own.kind === 'class'
        ? await imageUpdateQuery.eq('id', own.performance.id)
        : own.kind === 'gym'
          ? await imageUpdateQuery.in('id', own.performances.map((performance) => performance.id))
          : await imageUpdateQuery.eq('id', own.performance.id);
      if (updateError) {
        throw updateError;
      }
      return json({ updated: true, imagePath: path }, corsHeaders);
    }

    if (action === 'changePassword') {
      const current = password(body.currentPassword, '現在のパスワード');
      const next = password(body.newPassword, '新しいパスワード');
      if (next.length < 8) {throw new HttpError(400, '新しいパスワードは8文字以上で設定してください。');}
      if (!(await compare(current, admin.password_hash))) {throw new HttpError(400, '現在のパスワードが正しくありません。');}
      const { error } = await client.from('organization_admins').update({ password_hash: await hash(next, 10), updated_at: new Date().toISOString() }).eq('id', admin.id);
      if (error) {throw error;}
      return json({ updated: true }, corsHeaders);
    }
    throw new HttpError(400, '不明な操作です。');
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : '処理に失敗しました。';
    return json({ error: message }, corsHeaders, status);
  }
});
