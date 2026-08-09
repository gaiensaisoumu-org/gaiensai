


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "hypopg" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "index_advisor" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."rehearsal_type" AS ENUM (
    'official',
    'unofficial'
);


ALTER TYPE "public"."rehearsal_type" OWNER TO "postgres";


CREATE TYPE "public"."ticket_status" AS ENUM (
    'valid',
    'cancelled',
    'used'
);


ALTER TYPE "public"."ticket_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."adjust_class_ticket_counter_for_mapping_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_general integer := 0;
  v_junior integer := 0;
  v_other integer := 0;
BEGIN
  SELECT *
  INTO v_ticket
  FROM public.tickets
  WHERE id = OLD.id
  LIMIT 1;

  IF NOT FOUND OR v_ticket.status IS DISTINCT FROM 'valid' THEN
    RETURN OLD;
  END IF;

  IF v_ticket.ticket_type IN (1, 8) THEN
    v_general := v_ticket.person_count;
  ELSIF v_ticket.ticket_type = 5 THEN
    v_junior := v_ticket.person_count;
  ELSE
    v_other := v_ticket.person_count;
  END IF;

  UPDATE public.class_ticket_counters
  SET
    issued_general = greatest(issued_general - v_general, 0),
    issued_junior = greatest(issued_junior - v_junior, 0),
    issued_other = greatest(issued_other - v_other, 0),
    updated_at = now()
  WHERE class_id = OLD.class_id
    AND round_id = OLD.round_id;

  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."adjust_class_ticket_counter_for_mapping_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."adjust_class_ticket_counter_for_ticket_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_class_id smallint;
  v_round_id smallint;
  old_general integer := 0;
  old_junior integer := 0;
  old_other integer := 0;
  new_general integer := 0;
  new_junior integer := 0;
  new_other integer := 0;
BEGIN
  SELECT ct.class_id, ct.round_id
  INTO v_class_id, v_round_id
  FROM public.class_tickets ct
  WHERE ct.id = NEW.id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'valid' THEN
    IF OLD.ticket_type IN (1, 8) THEN
      old_general := OLD.person_count;
    ELSIF OLD.ticket_type = 5 THEN
      old_junior := OLD.person_count;
    ELSE
      old_other := OLD.person_count;
    END IF;
  END IF;

  IF NEW.status = 'valid' THEN
    IF NEW.ticket_type IN (1, 8) THEN
      new_general := NEW.person_count;
    ELSIF NEW.ticket_type = 5 THEN
      new_junior := NEW.person_count;
    ELSE
      new_other := NEW.person_count;
    END IF;
  END IF;

  IF old_general = new_general
     AND old_junior = new_junior
     AND old_other = new_other THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.class_ticket_counters (
    class_id,
    round_id,
    issued_general,
    issued_junior,
    issued_other
  )
  VALUES (
    v_class_id,
    v_round_id,
    greatest(new_general - old_general, 0),
    greatest(new_junior - old_junior, 0),
    greatest(new_other - old_other, 0)
  )
  ON CONFLICT (class_id, round_id) DO UPDATE
  SET
    issued_general = greatest(
      public.class_ticket_counters.issued_general
        + new_general - old_general,
      0
    ),
    issued_junior = greatest(
      public.class_ticket_counters.issued_junior
        + new_junior - old_junior,
      0
    ),
    issued_other = greatest(
      public.class_ticket_counters.issued_other
        + new_other - old_other,
      0
    ),
    updated_at = now();

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."adjust_class_ticket_counter_for_ticket_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."adjust_gym_ticket_counter_for_mapping_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_general integer := 0;
  v_junior integer := 0;
  v_other integer := 0;
BEGIN
  SELECT * INTO v_ticket FROM public.tickets WHERE id = OLD.id LIMIT 1;
  IF NOT FOUND OR v_ticket.status IS DISTINCT FROM 'valid' THEN RETURN OLD; END IF;

  IF v_ticket.ticket_type IN (3, 9) THEN v_general := v_ticket.person_count;
  ELSIF v_ticket.ticket_type = 6 THEN v_junior := v_ticket.person_count;
  ELSE v_other := v_ticket.person_count;
  END IF;

  UPDATE public.gym_ticket_counters SET
    issued_count = greatest(issued_count - v_general - v_junior - v_other, 0),
    issued_general = greatest(issued_general - v_general, 0),
    issued_junior = greatest(issued_junior - v_junior, 0),
    issued_other = greatest(issued_other - v_other, 0),
    updated_at = now()
  WHERE performance_id = OLD.performance_id;
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."adjust_gym_ticket_counter_for_mapping_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."adjust_gym_ticket_counter_for_ticket_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_performance_id smallint;
  old_general integer := 0;
  old_junior integer := 0;
  old_other integer := 0;
  new_general integer := 0;
  new_junior integer := 0;
  new_other integer := 0;
BEGIN
  SELECT gt.performance_id INTO v_performance_id
  FROM public.gym_tickets gt
  WHERE gt.id = NEW.id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'valid' THEN
    IF OLD.ticket_type IN (3, 9) THEN old_general := OLD.person_count;
    ELSIF OLD.ticket_type = 6 THEN old_junior := OLD.person_count;
    ELSE old_other := OLD.person_count;
    END IF;
  END IF;

  IF NEW.status = 'valid' THEN
    IF NEW.ticket_type IN (3, 9) THEN new_general := NEW.person_count;
    ELSIF NEW.ticket_type = 6 THEN new_junior := NEW.person_count;
    ELSE new_other := NEW.person_count;
    END IF;
  END IF;

  IF old_general = new_general AND old_junior = new_junior AND old_other = new_other THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.gym_ticket_counters (
    performance_id, issued_count, issued_general, issued_junior, issued_other
  ) VALUES (
    v_performance_id,
    greatest(new_general + new_junior + new_other - old_general - old_junior - old_other, 0),
    greatest(new_general - old_general, 0),
    greatest(new_junior - old_junior, 0),
    greatest(new_other - old_other, 0)
  ) ON CONFLICT (performance_id) DO UPDATE SET
    issued_count = greatest(public.gym_ticket_counters.issued_count + new_general + new_junior + new_other - old_general - old_junior - old_other, 0),
    issued_general = greatest(public.gym_ticket_counters.issued_general + new_general - old_general, 0),
    issued_junior = greatest(public.gym_ticket_counters.issued_junior + new_junior - old_junior, 0),
    issued_other = greatest(public.gym_ticket_counters.issued_other + new_other - old_other, 0),
    updated_at = now();

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."adjust_gym_ticket_counter_for_ticket_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_own_ticket_by_code"("p_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_id uuid;
  v_user uuid;
  v_status public.ticket_status;
begin
  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'code is required';
  end if;

  select id, user_id, status
  into v_id, v_user, v_status
  from public.tickets
  where code = p_code
  limit 1
  for update;

  if not found then
    raise exception 'ticket not found';
  end if;

  if v_status is distinct from 'valid' then
    raise exception 'only valid tickets can be cancelled';
  end if;

  update public.tickets
  set status = 'cancelled', updated_at = now()
  where id = v_id;

  return true;
end;
$$;


ALTER FUNCTION "public"."cancel_own_ticket_by_code"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_student_account"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
  UPDATE public.users
  SET account_confirmed = true
  WHERE id = auth.uid() AND role = 'student';

  IF NOT FOUND THEN
    RAISE EXCEPTION '生徒アカウントが見つかりません。';
  END IF;
END;
$$;


ALTER FUNCTION "public"."confirm_student_account"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_user"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- 現在ログインしているユーザーのIDを取得し、auth.usersから削除
  delete from auth.users where id = auth.uid();
  delete from public.users where id = auth.uid();
end;
$$;


ALTER FUNCTION "public"."delete_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_junior_status_dashboard"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
WITH junior_users AS (
  SELECT id, affiliation, junior_usage_type, application_day
  FROM public.users
  WHERE role = 'junior'
),
usage_rows AS (
  SELECT CASE coalesce(junior_usage_type, 0)
    WHEN 0 THEN '中学生・保護者（共通）'
    WHEN 1 THEN '中学生・保護者（別々）'
    WHEN 2 THEN '中学生のみ'
    WHEN 3 THEN '保護者のみ'
    ELSE '未設定'
  END AS name, count(*) AS value
  FROM junior_users
  GROUP BY 1
),
application_rows AS (
  SELECT coalesce(nullif(application_day, ''), '未設定') AS name, count(*) AS value
  FROM junior_users
  GROUP BY 1
),
booked_junior_users AS (
  SELECT DISTINCT ju.id
  FROM junior_users ju
  JOIN public.tickets t ON t.user_id = ju.id
  WHERE coalesce(ju.junior_usage_type, 0) IN (0, 2)
    AND t.status = 'valid'
    AND t.ticket_type IN (5, 6)
),
next_affiliation AS (
  SELECT CASE
    WHEN (((coalesce(max(affiliation), 100000) + 1 - 100000) >> 6) & 15) = 15
      THEN coalesce(max(affiliation), 100000) + 1
        + (64 - ((coalesce(max(affiliation), 100000) + 1 - 100000) % 64))
    ELSE coalesce(max(affiliation), 100000) + 1
  END AS value
  FROM junior_users
)
SELECT jsonb_build_object(
  'registeredCount', (SELECT count(*) FROM junior_users),
  'admissionOnlyCount', coalesce((SELECT admission_only_count FROM public.junior_admission_only_account_counts WHERE id = 1), 0),
  'reservationEligibleCount', greatest(
    (SELECT count(*) FROM junior_users) - coalesce((SELECT admission_only_count FROM public.junior_admission_only_account_counts WHERE id = 1), 0),
    0
  ),
  'bookedJuniorCount', (SELECT count(*) FROM booked_junior_users),
  'nextAffiliation', (SELECT value FROM next_affiliation),
  'separateOnRegistrationCount', coalesce((SELECT separate_on_registration_count FROM public.junior_account_split_counters WHERE id = 1), 0),
  'laterSplitCount', coalesce((SELECT later_split_count FROM public.junior_account_split_counters WHERE id = 1), 0),
  'usageTypes', coalesce((SELECT jsonb_agg(to_jsonb(usage_rows) ORDER BY name) FROM usage_rows), '[]'::jsonb),
  'applicationDays', coalesce((SELECT jsonb_agg(to_jsonb(application_rows) ORDER BY name) FROM application_rows), '[]'::jsonb)
);
$$;


ALTER FUNCTION "public"."get_admin_junior_status_dashboard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_status_dashboard"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $_$
WITH student_accounts AS (
  SELECT split_part(email, '@', 1)::integer AS affiliation
  FROM auth.users
  WHERE email ~ '^[1-3][0-9]{4}@gaiensai\.local$'
),
student_profiles AS (
  SELECT id, affiliation
  FROM public.users
  WHERE role = 'student'
),
valid_tickets AS (
  SELECT id, user_id, person_count
  FROM public.tickets
  WHERE status = 'valid'
),
class_account_rows AS (
  SELECT
    format('%s-%s', affiliation / 10000, (affiliation / 100) % 100) AS name,
    count(*) AS account_count
  FROM student_accounts
  GROUP BY 1
),
class_initial_rows AS (
  SELECT
    format('%s-%s', affiliation / 10000, (affiliation / 100) % 100) AS name,
    count(*) AS initial_count
  FROM student_profiles
  GROUP BY 1
),
class_ticket_rows AS (
  SELECT
    format('%s-%s', sp.affiliation / 10000, (sp.affiliation / 100) % 100) AS name,
    count(vt.id) AS ticket_count,
    coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM student_profiles sp
  JOIN valid_tickets vt ON vt.user_id = sp.id
  GROUP BY 1
),
class_rows AS (
  SELECT
    car.name,
    car.account_count,
    coalesce(cir.initial_count, 0) AS initial_count,
    coalesce(ctr.ticket_count, 0) AS ticket_count,
    coalesce(ctr.visitor_count, 0) AS visitor_count
  FROM class_account_rows car
  LEFT JOIN class_initial_rows cir ON cir.name = car.name
  LEFT JOIN class_ticket_rows ctr ON ctr.name = car.name
)
SELECT public.get_admin_status_dashboard_base()
  || jsonb_build_object(
    'classes',
    coalesce(
      (SELECT jsonb_agg(to_jsonb(class_rows) ORDER BY name) FROM class_rows),
      '[]'::jsonb
    )
  );
$_$;


ALTER FUNCTION "public"."get_admin_status_dashboard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_status_dashboard_base"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $_$
WITH student_accounts AS (
  SELECT
    split_part(email, '@', 1)::integer AS affiliation
  FROM auth.users
  WHERE email ~ '^[1-3][0-9]{4}@gaiensai\.local$'
),
student_profiles AS (
  SELECT id, affiliation, clubs
  FROM public.users
  WHERE role = 'student'
),
valid_tickets AS (
  SELECT t.*
  FROM public.tickets t
  WHERE t.status = 'valid'
),
class_ticket_rows AS (
  -- 発券者の所属は、初回登録済みの users.affiliation を基準にする。
  SELECT
    sp.affiliation,
    count(vt.id) AS ticket_count,
    coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM student_profiles sp
  JOIN valid_tickets vt ON vt.user_id = sp.id
  GROUP BY sp.affiliation
),
class_rows AS (
  SELECT
    format(
      '%s-%s',
      sa.affiliation / 10000,
      (sa.affiliation / 100) % 100
    ) AS name,
    count(*) AS account_count,
    count(sp.id) AS initial_count,
    coalesce(ctr.ticket_count, 0) AS ticket_count,
    coalesce(ctr.visitor_count, 0) AS visitor_count
  FROM student_accounts sa
  LEFT JOIN student_profiles sp ON sp.affiliation = sa.affiliation
  LEFT JOIN class_ticket_rows ctr ON ctr.affiliation = sa.affiliation
  GROUP BY 1, ctr.ticket_count, ctr.visitor_count
),
club_rows AS (
  SELECT
    club AS name,
    count(DISTINCT sp.id) AS account_count,
    count(vt.id) AS ticket_count,
    coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM student_profiles sp
  CROSS JOIN LATERAL unnest(coalesce(sp.clubs, ARRAY[]::text[])) AS club
  LEFT JOIN valid_tickets vt ON vt.user_id = sp.id
  GROUP BY club
),
performance_rows AS (
  SELECT cp.class_name AS name,
         count(vt.id) AS ticket_count, coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM valid_tickets vt
  JOIN public.class_tickets ct ON ct.id = vt.id
  JOIN public.class_performances cp ON cp.id = ct.class_id
  GROUP BY cp.class_name
  UNION ALL
  SELECT gp.group_name AS name,
         count(vt.id), coalesce(sum(vt.person_count), 0)
  FROM valid_tickets vt
  JOIN public.gym_tickets gt ON gt.id = vt.id
  JOIN public.gym_performances gp ON gp.id = gt.performance_id
  GROUP BY gp.group_name
  UNION ALL
  SELECT '入場専用券' AS name, count(vt.id), coalesce(sum(vt.person_count), 0)
  FROM valid_tickets vt
  WHERE NOT EXISTS (SELECT 1 FROM public.class_tickets ct WHERE ct.id = vt.id)
    AND NOT EXISTS (SELECT 1 FROM public.gym_tickets gt WHERE gt.id = vt.id)
),
ticket_performance_rows AS (
  SELECT
    cp.class_name AS name,
    count(vt.id) AS ticket_count,
    coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM valid_tickets vt
  JOIN public.class_tickets ct ON ct.id = vt.id
  JOIN public.class_performances cp ON cp.id = ct.class_id
  GROUP BY cp.class_name
),
gym_performance_rows AS (
  SELECT
    gp.group_name AS name,
    count(vt.id) AS ticket_count,
    coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM valid_tickets vt
  JOIN public.gym_tickets gt ON gt.id = vt.id
  JOIN public.gym_performances gp ON gp.id = gt.performance_id
  GROUP BY gp.group_name
),
time_rows AS (
  SELECT
    time_source.name,
    sum(time_source.ticket_count) AS ticket_count,
    sum(time_source.visitor_count) AS visitor_count
  FROM (
    SELECT
      ps.round_name || '（'
        || to_char(ps.start_at AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI')
        || '）' AS name,
      count(vt.id) AS ticket_count,
      coalesce(sum(vt.person_count), 0) AS visitor_count
    FROM valid_tickets vt
    JOIN public.class_tickets ct ON ct.id = vt.id
    JOIN public.performances_schedule ps ON ps.id = ct.round_id
    GROUP BY ps.round_name, ps.start_at
    UNION ALL
    SELECT
      gp.group_name || ' / ' || gp.round_name || '（'
        || to_char(gp.start_at AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI')
        || '）' AS name,
      count(vt.id),
      coalesce(sum(vt.person_count), 0)
    FROM valid_tickets vt
    JOIN public.gym_tickets gt ON gt.id = vt.id
    JOIN public.gym_performances gp ON gp.id = gt.performance_id
    GROUP BY gp.group_name, gp.round_name, gp.start_at
  ) AS time_source
  GROUP BY time_source.name
),
relationship_rows AS (
  SELECT r.name, count(vt.id) AS ticket_count, coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM valid_tickets vt JOIN public.relationships r ON r.id = vt.relationship
  GROUP BY r.name
),
ticket_type_rows AS (
  SELECT tt.type || ' ' || tt.name AS name,
         count(vt.id) AS ticket_count, coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM valid_tickets vt JOIN public.ticket_types tt ON tt.id = vt.ticket_type
  GROUP BY tt.type, tt.name
)
SELECT jsonb_build_object(
  'overview', jsonb_build_object(
    'studentAccounts', (SELECT count(*) FROM student_accounts),
    'initialRegistrations', (SELECT count(*) FROM student_profiles),
    'juniorRegistrations', (SELECT count(*) FROM public.users WHERE role = 'junior'),
    'issuedTickets', (SELECT count(*) FROM public.tickets),
    'validTickets', (SELECT count(*) FROM valid_tickets),
    'validVisitors', (SELECT coalesce(sum(person_count), 0) FROM valid_tickets),
    'cancelledTickets', (SELECT count(*) FROM public.tickets WHERE status <> 'valid')
  ),
  'classes', coalesce((SELECT jsonb_agg(to_jsonb(class_rows) ORDER BY name) FROM class_rows), '[]'::jsonb),
  'clubs', coalesce((SELECT jsonb_agg(to_jsonb(club_rows) ORDER BY ticket_count DESC, name) FROM club_rows), '[]'::jsonb),
  'rankings', jsonb_build_object(
    'performances', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM performance_rows ORDER BY ticket_count DESC, name LIMIT 10) x), '[]'::jsonb),
    'ticketPerformances', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM ticket_performance_rows ORDER BY ticket_count DESC, name LIMIT 10) x), '[]'::jsonb),
    'gymPerformances', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM gym_performance_rows ORDER BY ticket_count DESC, name LIMIT 10) x), '[]'::jsonb),
    'times', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM time_rows ORDER BY ticket_count DESC, name LIMIT 10) x), '[]'::jsonb),
    'relationships', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM relationship_rows ORDER BY ticket_count DESC, name) x), '[]'::jsonb),
    'ticketTypes', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM ticket_type_rows ORDER BY ticket_count DESC, name) x), '[]'::jsonb)
  )
);
$_$;


ALTER FUNCTION "public"."get_admin_status_dashboard_base"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admission_only_junior_account_count"() RETURNS integer
    LANGUAGE "sql" STABLE
    AS $$
  SELECT admission_only_count
  FROM public.junior_admission_only_account_counts
  WHERE id = 1;
$$;


ALTER FUNCTION "public"."get_admission_only_junior_account_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_junior_issue_bootstrap"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  WITH issue_user AS (
    SELECT id, application_day, junior_usage_type FROM public.users
    WHERE id = auth.uid() AND role = 'junior'
  ), valid_tickets AS (
    SELECT ticket_type FROM public.tickets
    WHERE user_id = auth.uid() AND status = 'valid'
  )
  SELECT jsonb_build_object(
    'profile', (SELECT to_jsonb(issue_user) FROM issue_user),
    'config', (SELECT to_jsonb(c) FROM public.configs c ORDER BY c.id LIMIT 1),
    'controls', (SELECT to_jsonb(tic) FROM public.ticket_issue_controls tic WHERE tic.id = 1),
    'entry_only_ticket_count', (SELECT count(*) FROM valid_tickets WHERE ticket_type = 7),
    'non_entry_ticket_count', (SELECT count(*) FROM valid_tickets WHERE ticket_type <> 7),
    'ticket_types', coalesce((SELECT jsonb_agg(jsonb_build_object('id', tt.id, 'name', tt.name, 'type', tt.type) ORDER BY tt.id) FROM public.ticket_types tt WHERE tt.type = '中学生券'), '[]'::jsonb)
  ) WHERE EXISTS (SELECT 1 FROM issue_user);
$$;


ALTER FUNCTION "public"."get_junior_issue_bootstrap"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_junior_my_page"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  WITH dashboard_user AS (
    SELECT id, application_day
    FROM public.users
    WHERE id = auth.uid() AND role = 'junior'
  ),
  valid_tickets AS (
    SELECT id, code, signature, relationship, created_at, ticket_name, ticket_type
    FROM public.tickets
    WHERE user_id = auth.uid() AND status = 'valid'
  )
  SELECT jsonb_build_object(
    'profile', (SELECT to_jsonb(dashboard_user) FROM dashboard_user),
    'config', (SELECT jsonb_build_object('is_active', is_active, 'max_tickets_per_junior_user', max_tickets_per_junior_user) FROM public.configs ORDER BY id LIMIT 1),
    'controls', (SELECT jsonb_build_object('class_invite_mode', class_invite_mode, 'rehearsal_invite_mode', rehearsal_invite_mode, 'gym_invite_mode', gym_invite_mode, 'entry_only_mode', entry_only_mode) FROM public.ticket_issue_controls WHERE id = 1),
    'non_entry_ticket_count', (SELECT count(*) FROM valid_tickets WHERE ticket_type <> 7),
    'entry_only_ticket_count', (SELECT count(*) FROM valid_tickets WHERE ticket_type = 7),
    'tickets', coalesce((SELECT jsonb_agg(to_jsonb(valid_tickets) ORDER BY created_at DESC) FROM valid_tickets), '[]'::jsonb),
    'class_performances', coalesce((SELECT jsonb_agg(jsonb_build_object('id', cp.id, 'class_name', cp.class_name, 'title', cp.title)) FROM public.class_performances cp JOIN public.class_tickets ct ON ct.class_id = cp.id JOIN valid_tickets t ON t.id = ct.id), '[]'::jsonb),
    'gym_performances', coalesce((SELECT jsonb_agg(jsonb_build_object('id', gp.id, 'group_name', gp.group_name, 'round_name', gp.round_name)) FROM public.gym_performances gp JOIN public.gym_tickets gt ON gt.performance_id = gp.id JOIN valid_tickets t ON t.id = gt.id), '[]'::jsonb)
  )
  WHERE EXISTS (SELECT 1 FROM dashboard_user);
$$;


ALTER FUNCTION "public"."get_junior_my_page"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_performance_availability"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  SELECT jsonb_build_object(
    'config', (SELECT jsonb_build_object('junior_release_open', junior_release_open) FROM public.configs ORDER BY id LIMIT 1),
    'class_performances', coalesce((SELECT jsonb_agg(to_jsonb(cp) ORDER BY cp.id) FROM public.class_performances cp), '[]'::jsonb),
    'schedules', coalesce((SELECT jsonb_agg(to_jsonb(ps) ORDER BY ps.id) FROM public.performances_schedule ps), '[]'::jsonb),
    'class_counters', coalesce((SELECT jsonb_agg(to_jsonb(ctc)) FROM public.class_ticket_counters ctc), '[]'::jsonb),
    'gym_performances', coalesce((SELECT jsonb_agg(to_jsonb(gp) ORDER BY gp.start_at, gp.id) FROM public.gym_performances gp), '[]'::jsonb),
    'gym_counters', coalesce((SELECT jsonb_agg(to_jsonb(gtc)) FROM public.gym_ticket_counters gtc), '[]'::jsonb)
  );
$$;


ALTER FUNCTION "public"."get_performance_availability"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_performance_acceptance"() RETURNS TABLE("performance_type" "text", "performance_id" smallint, "is_accepting" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH settings AS (
    SELECT is_active FROM public.configs ORDER BY id LIMIT 1
  ), controls AS (
    SELECT
      class_invite_mode,
      rehearsal_invite_mode,
      same_day_class_mode,
      junior_class_mode,
      gym_invite_mode,
      same_day_gym_mode,
      junior_gym_mode
    FROM public.ticket_issue_controls
    WHERE id = 1
  )
  SELECT
    'class'::text,
    cp.id,
    COALESCE(settings.is_active, false)
      AND (
        COALESCE(controls.class_invite_mode <> 'off', false)
        OR COALESCE(controls.rehearsal_invite_mode <> 'off', false)
        OR COALESCE(controls.same_day_class_mode <> 'off', false)
        OR COALESCE(controls.junior_class_mode <> 'off', false)
      )
      AND COALESCE(cp.is_accepting, false)
      AND EXISTS (
        SELECT 1
        FROM public.performances_schedule ps
        LEFT JOIN public.class_ticket_counters ctc
          ON ctc.class_id = cp.id AND ctc.round_id = ps.id
        WHERE ps.is_active = true
          AND cp.total_capacity > (
            COALESCE(ctc.issued_general, 0)
            + COALESCE(ctc.issued_junior, 0)
            + COALESCE(ctc.issued_other, 0)
          )
      )
  FROM public.class_performances cp
  CROSS JOIN settings
  CROSS JOIN controls

  UNION ALL

  SELECT
    'gym'::text,
    gp.id,
    COALESCE(settings.is_active, false)
      AND (
        COALESCE(controls.gym_invite_mode <> 'off', false)
        OR COALESCE(controls.same_day_gym_mode <> 'off', false)
        OR COALESCE(controls.junior_gym_mode <> 'off', false)
      )
      AND COALESCE(gp.is_accepting, false)
      AND gp.capacity > COALESCE(gtc.issued_count, 0)
  FROM public.gym_performances gp
  CROSS JOIN settings
  CROSS JOIN controls
  LEFT JOIN public.gym_ticket_counters gtc
    ON gtc.performance_id = gp.id;
$$;


ALTER FUNCTION "public"."get_public_performance_acceptance"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_student_class_ticket_remaining"("p_class_id" smallint) RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  WITH current_user_data AS (
    SELECT affiliation FROM public.users WHERE id = auth.uid() AND role = 'student'
  ), target_class AS (
    SELECT class_name, max_tickets_per_user FROM public.class_performances WHERE id = p_class_id
  ), ticket_count AS (
    SELECT count(*)::integer AS value
    FROM public.tickets t
    JOIN public.class_tickets ct ON ct.id = t.id
    WHERE t.user_id = auth.uid() AND t.status = 'valid' AND ct.class_id = p_class_id
  )
  SELECT greatest(
    CASE WHEN tc.class_name = concat(
      floor(cud.affiliation / 10000), '-', floor((cud.affiliation % 10000) / 100)
    ) THEN tc.max_tickets_per_user
    ELSE (SELECT max_tickets_per_other_class_user FROM public.configs ORDER BY id LIMIT 1)
    END - ticket_count.value, 0
  )
  FROM current_user_data cud CROSS JOIN target_class tc CROSS JOIN ticket_count;
$$;


ALTER FUNCTION "public"."get_student_class_ticket_remaining"("p_class_id" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_student_dashboard"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  WITH dashboard_user AS (SELECT id, affiliation, clubs, account_confirmed FROM public.users WHERE id = auth.uid() AND role = 'student'),
  valid_tickets AS (SELECT id, code, signature, relationship, created_at, ticket_name FROM public.tickets WHERE user_id = auth.uid() AND status = 'valid')
  SELECT jsonb_build_object(
    'profile', (SELECT to_jsonb(dashboard_user) FROM dashboard_user),
    'config', (SELECT jsonb_build_object('is_active', is_active, 'show_length', show_length, 'max_tickets_per_other_class_user', max_tickets_per_other_class_user, 'max_tickets_per_other_performance_user', max_tickets_per_other_performance_user, 'max_tickets_per_other_club_user', max_tickets_per_other_club_user, 'gym_ticket_limits_by_club', gym_ticket_limits_by_club) FROM public.configs ORDER BY id LIMIT 1),
    'controls', (SELECT jsonb_build_object('class_invite_mode', class_invite_mode, 'rehearsal_invite_mode', rehearsal_invite_mode, 'gym_invite_mode', gym_invite_mode, 'entry_only_mode', entry_only_mode) FROM public.ticket_issue_controls WHERE id = 1),
    'class_ticket_count', (SELECT count(*) FROM public.class_tickets ct JOIN valid_tickets t ON t.id = ct.id),
    'gym_ticket_count', (SELECT count(*) FROM public.gym_tickets gt JOIN valid_tickets t ON t.id = gt.id),
    'tickets', coalesce((SELECT jsonb_agg(to_jsonb(valid_tickets) ORDER BY created_at DESC) FROM valid_tickets), '[]'::jsonb),
    'class_performances', coalesce((SELECT jsonb_agg(jsonb_build_object('id', cp.id, 'class_name', cp.class_name, 'title', cp.title)) FROM public.class_performances cp JOIN public.class_tickets ct ON ct.class_id = cp.id JOIN valid_tickets t ON t.id = ct.id), '[]'::jsonb),
    'gym_performances', coalesce((SELECT jsonb_agg(jsonb_build_object('id', gp.id, 'group_name', gp.group_name, 'round_name', gp.round_name, 'start_at', gp.start_at, 'end_at', gp.end_at)) FROM public.gym_performances gp JOIN public.gym_tickets gt ON gt.performance_id = gp.id JOIN valid_tickets t ON t.id = gt.id), '[]'::jsonb),
    'schedules', coalesce((SELECT jsonb_agg(jsonb_build_object('id', ps.id, 'start_at', ps.start_at)) FROM public.performances_schedule ps JOIN public.class_tickets ct ON ct.round_id = ps.id JOIN valid_tickets t ON t.id = ct.id), '[]'::jsonb)
  ) WHERE EXISTS (SELECT 1 FROM dashboard_user);
$$;


ALTER FUNCTION "public"."get_student_dashboard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_student_gym_ticket_remaining"("p_performance_id" smallint) RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  WITH u AS (SELECT affiliation, coalesce(clubs, '{}'::text[]) AS clubs FROM public.users WHERE id = auth.uid() AND role = 'student'),
  target AS (SELECT group_name FROM public.gym_performances WHERE id = p_performance_id),
  config AS (SELECT max_tickets_per_other_club_user, gym_ticket_limits_by_club FROM public.configs ORDER BY id LIMIT 1),
  group_ids AS (SELECT gp.id FROM public.gym_performances gp, target WHERE gp.group_name = target.group_name),
  group_count AS (SELECT count(*)::integer AS value FROM public.tickets t JOIN public.gym_tickets gt ON gt.id = t.id WHERE t.user_id = auth.uid() AND t.status = 'valid' AND gt.performance_id IN (SELECT id FROM group_ids))
  SELECT greatest(
    CASE WHEN target.group_name = ANY(u.clubs)
      THEN coalesce((config.gym_ticket_limits_by_club ->> target.group_name)::integer, config.max_tickets_per_other_club_user)
      ELSE config.max_tickets_per_other_club_user END - group_count.value,
    0
  )::integer
  FROM u CROSS JOIN target CROSS JOIN config CROSS JOIN group_count;
$$;


ALTER FUNCTION "public"."get_student_gym_ticket_remaining"("p_performance_id" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_student_issue_bootstrap"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  WITH issue_user AS (
    SELECT id, affiliation, clubs FROM public.users
    WHERE id = auth.uid() AND role = 'student'
  ), valid_tickets AS (
    SELECT id FROM public.tickets WHERE user_id = auth.uid() AND status = 'valid'
  )
  SELECT jsonb_build_object(
    'profile', (SELECT to_jsonb(issue_user) FROM issue_user),
    'config', (SELECT to_jsonb(c) FROM public.configs c ORDER BY c.id LIMIT 1),
    'controls', (SELECT to_jsonb(tic) FROM public.ticket_issue_controls tic WHERE tic.id = 1),
    'class_ticket_count', (SELECT count(*) FROM public.class_tickets ct JOIN valid_tickets t ON t.id = ct.id),
    'gym_ticket_count', (SELECT count(*) FROM public.gym_tickets gt JOIN valid_tickets t ON t.id = gt.id),
    'ticket_types', coalesce((SELECT jsonb_agg(jsonb_build_object('id', tt.id, 'name', tt.name, 'type', tt.type) ORDER BY tt.id) FROM public.ticket_types tt WHERE tt.type = '招待券'), '[]'::jsonb),
    'relationships', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) ORDER BY r.id) FROM public.relationships r WHERE r.is_accepting = true), '[]'::jsonb)
  ) WHERE EXISTS (SELECT 1 FROM issue_user);
$$;


ALTER FUNCTION "public"."get_student_issue_bootstrap"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_student_other_performance_total_remaining"() RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  WITH u AS (SELECT affiliation, coalesce(clubs, '{}'::text[]) AS clubs FROM public.users WHERE id = auth.uid() AND role = 'student'),
  config AS (SELECT max_tickets_per_other_performance_user FROM public.configs ORDER BY id LIMIT 1),
  other_classes AS (SELECT id FROM public.class_performances, u WHERE class_name <> concat(floor(u.affiliation / 10000), '-', floor((u.affiliation % 10000) / 100))),
  other_gyms AS (SELECT id FROM public.gym_performances, u WHERE NOT (group_name = ANY(u.clubs))),
  used AS (
    SELECT
      (SELECT count(*) FROM public.tickets t JOIN public.class_tickets ct ON ct.id = t.id WHERE t.user_id = auth.uid() AND t.status = 'valid' AND ct.class_id IN (SELECT id FROM other_classes)) +
      (SELECT count(*) FROM public.tickets t JOIN public.gym_tickets gt ON gt.id = t.id WHERE t.user_id = auth.uid() AND t.status = 'valid' AND gt.performance_id IN (SELECT id FROM other_gyms)) AS value
  )
  SELECT greatest(config.max_tickets_per_other_performance_user - used.value, 0)::integer FROM config CROSS JOIN used;
$$;


ALTER FUNCTION "public"."get_student_other_performance_total_remaining"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_student_performance_ticket_remaining"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  SELECT jsonb_build_object(
    'class', coalesce((SELECT jsonb_object_agg(cp.id::text, greatest(CASE WHEN cp.class_name = concat(floor(u.affiliation / 10000), '-', floor((u.affiliation % 10000) / 100)) THEN cp.max_tickets_per_user ELSE cfg.max_tickets_per_other_class_user END - coalesce(c.issued_count, 0), 0)) FROM public.class_performances cp CROSS JOIN public.configs cfg CROSS JOIN public.users u LEFT JOIN public.student_ticket_issue_counters c ON c.performance_id = cp.id AND c.performance_type = 'class' AND c.user_id = auth.uid() WHERE u.id = auth.uid()), '{}'::jsonb),
    'gym', coalesce((SELECT jsonb_object_agg(gp.id::text, greatest(CASE WHEN gp.group_name = ANY(coalesce(u.clubs, '{}'::text[])) THEN coalesce((cfg.gym_ticket_limits_by_club ->> gp.group_name)::integer, cfg.max_tickets_per_other_club_user) ELSE cfg.max_tickets_per_other_club_user END - coalesce(c.issued_count, 0), 0)) FROM public.gym_performances gp CROSS JOIN public.configs cfg CROSS JOIN public.users u LEFT JOIN public.student_ticket_issue_counters c ON c.performance_id = gp.id AND c.performance_type = 'gym' AND c.user_id = auth.uid() WHERE u.id = auth.uid()), '{}'::jsonb),
    'class_names', coalesce((SELECT jsonb_object_agg(id::text, class_name) FROM public.class_performances), '{}'::jsonb),
    'gym_names', coalesce((SELECT jsonb_object_agg(id::text, group_name) FROM public.gym_performances), '{}'::jsonb),
    'other_total_remaining', public.get_student_other_performance_total_remaining()
  );
$$;


ALTER FUNCTION "public"."get_student_performance_ticket_remaining"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_by_email"("user_email" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN (SELECT id
          FROM auth.users
          WHERE email = user_email
          LIMIT 1);
END;
$$;


ALTER FUNCTION "public"."get_user_by_email"("user_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_rank"("target_id" "uuid") RETURNS TABLE("player_rank" bigint)
    LANGUAGE "plpgsql"
    AS $$
begin
  return query
  with ranked_leaderboard as (
    select 
      id,
      rank() over (order by score desc) as rk
    from flappy_leaderboard
  )
  select rk
  from ranked_leaderboard 
  where id = target_id;
end;
$$;


ALTER FUNCTION "public"."get_user_rank"("target_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."hash_password"("p_password" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
begin
  return extensions.crypt(p_password, extensions.gen_salt('bf'));
end;
$$;


ALTER FUNCTION "public"."hash_password"("p_password" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_ticket_code_counter"("p_prefix" "text", "p_increment" integer, "p_max_value" integer) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$declare
  v_last_value bigint;
begin
  if p_prefix is null or length(trim(p_prefix)) = 0 then
    raise exception 'prefix is required';
  end if;

  if p_increment is null or p_increment <= 0 then
    raise exception 'increment must be positive';
  end if;

  -- 1. 行が存在しない場合は初期化（既存なら何もしない）
  insert into public.ticket_code_counters (prefix, last_value)
  values (p_prefix, 0)
  on conflict (prefix) do nothing;

  -- 2. 条件付きでアップデート
  -- WHERE句で「更新後の値がp_max_value以下であること」を保証する
  update public.ticket_code_counters
  set last_value = last_value + p_increment,
      updated_at = now()
  where prefix = p_prefix
    and last_value + p_increment < p_max_value
  returning last_value into v_last_value;

  -- 3. v_last_value が null ということは、WHERE条件に合致しなかった（＝p_max_valueを超えた）ということ
  if v_last_value is null then
    raise exception 'The maximum number of cards that can be issued (% cards) has been exceeded. (Current limit: %)', p_max_value, p_max_value;
  end if;

  return v_last_value;
end;$$;


ALTER FUNCTION "public"."increment_ticket_code_counter"("p_prefix" "text", "p_increment" integer, "p_max_value" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."issue_class_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" integer, "p_relationship_id" integer, "p_performance_id" integer, "p_schedule_id" integer, "p_issue_count" integer, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" integer DEFAULT 1) RETURNS TABLE("code" "text", "signature" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  i integer;
  v_ticket_id uuid;
  v_total_cap integer;
  v_junior_cap integer;
  v_is_released boolean;
  v_issued_gen integer;
  v_issued_jun integer;
  v_issued_other integer;
  v_need integer;
  v_rem_gen integer;
  v_rem_jun integer;
  v_rem_gen_raw integer;
  v_add_gen integer := 0;
  v_add_jun integer := 0;
  v_add_other integer := 0;
BEGIN
  IF p_issue_count IS NULL OR p_issue_count <= 0 THEN
    RAISE EXCEPTION 'issue_count must be positive';
  END IF;

  IF array_length(p_codes, 1) IS DISTINCT FROM p_issue_count
     OR array_length(p_signatures, 1) IS DISTINCT FROM p_issue_count THEN
    RAISE EXCEPTION 'codes/signatures length mismatch';
  END IF;

  v_need := p_issue_count * p_person_count;

  IF p_performance_id > 0 AND p_schedule_id > 0 THEN
    INSERT INTO public.class_ticket_counters (class_id, round_id)
    VALUES (p_performance_id, p_schedule_id)
    ON CONFLICT (class_id, round_id) DO NOTHING;

    SELECT
      cp.total_capacity,
      cp.junior_capacity,
      coalesce(cfg.junior_release_open, false),
      ctc.issued_general,
      ctc.issued_junior,
      ctc.issued_other
    INTO
      v_total_cap,
      v_junior_cap,
      v_is_released,
      v_issued_gen,
      v_issued_jun,
      v_issued_other
    FROM public.class_ticket_counters ctc
    JOIN public.class_performances cp ON cp.id = ctc.class_id
    CROSS JOIN LATERAL (
      SELECT c.junior_release_open
      FROM public.configs c
      ORDER BY c.id ASC
      LIMIT 1
    ) cfg
    WHERE ctc.class_id = p_performance_id
      AND ctc.round_id = p_schedule_id
    FOR UPDATE OF ctc;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'class ticket counter was not initialized';
    END IF;

    IF v_is_released THEN
      v_rem_gen := greatest(
        v_total_cap - v_issued_gen - v_issued_jun - v_issued_other,
        0
      );
      v_rem_jun := v_rem_gen;
    ELSE
      v_rem_gen_raw := (v_total_cap - v_junior_cap)
        - v_issued_gen
        - v_issued_other;
      v_rem_gen := greatest(v_rem_gen_raw, 0);
      v_rem_jun := greatest(
        v_junior_cap - v_issued_jun - greatest(-v_rem_gen_raw, 0),
        0
      );
    END IF;

    IF p_ticket_type_id = 5 THEN
      IF (v_is_released AND v_rem_gen < v_need)
         OR (NOT v_is_released AND v_rem_jun < v_need) THEN
        RAISE EXCEPTION '中学生用の予約枠が上限に達しました。';
      END IF;
      v_add_jun := v_need;
    ELSIF p_ticket_type_id = 8 THEN
      IF (v_rem_gen + v_rem_jun) < v_need THEN
        RAISE EXCEPTION 'この公演はすでに満席です。';
      END IF;
      v_add_gen := v_need;
    ELSIF p_ticket_type_id = 1 THEN
      IF v_rem_gen < v_need THEN
        RAISE EXCEPTION '招待券用の残席がありません。';
      END IF;
      v_add_gen := v_need;
    ELSE
      IF (v_rem_gen + v_rem_jun) < v_need THEN
        RAISE EXCEPTION '規定の定員を超過しています。';
      END IF;
      v_add_other := v_need;
    END IF;

    UPDATE public.class_ticket_counters
    SET
      issued_general = issued_general + v_add_gen,
      issued_junior = issued_junior + v_add_jun,
      issued_other = issued_other + v_add_other,
      updated_at = now()
    WHERE class_id = p_performance_id
      AND round_id = p_schedule_id;
  END IF;

  FOR i IN 1..p_issue_count LOOP
    INSERT INTO public.tickets (
      user_id,
      ticket_type,
      relationship,
      status,
      code,
      signature,
      person_count
    )
    VALUES (
      p_user_id,
      p_ticket_type_id,
      p_relationship_id,
      'valid',
      p_codes[i],
      p_signatures[i],
      p_person_count
    )
    RETURNING id INTO v_ticket_id;

    IF p_performance_id > 0 AND p_schedule_id > 0 THEN
      INSERT INTO public.class_tickets (id, class_id, round_id)
      VALUES (v_ticket_id, p_performance_id, p_schedule_id);
    END IF;
  END LOOP;

  RETURN QUERY SELECT unnest(p_codes), unnest(p_signatures);
END;
$$;


ALTER FUNCTION "public"."issue_class_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" integer, "p_relationship_id" integer, "p_performance_id" integer, "p_schedule_id" integer, "p_issue_count" integer, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."issue_gym_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" smallint, "p_relationship_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint DEFAULT 1) RETURNS TABLE("code" "text", "signature" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  i integer; v_ticket_id uuid; v_capacity integer; v_junior_capacity integer;
  v_is_released boolean; v_issued_general integer; v_issued_junior integer;
  v_issued_other integer; v_need integer; v_general_remaining_raw integer;
  v_general_remaining integer; v_junior_remaining integer;
BEGIN
  IF p_issue_count IS NULL OR p_issue_count <= 0 THEN RAISE EXCEPTION 'issue_count must be positive'; END IF;
  IF array_length(p_codes, 1) IS DISTINCT FROM p_issue_count OR array_length(p_signatures, 1) IS DISTINCT FROM p_issue_count THEN RAISE EXCEPTION 'codes/signatures length mismatch'; END IF;
  v_need := p_issue_count * p_person_count;

  INSERT INTO public.gym_ticket_counters (performance_id) VALUES (p_performance_id) ON CONFLICT (performance_id) DO NOTHING;
  SELECT gp.capacity, gp.junior_capacity, coalesce(cfg.junior_release_open, false),
    gtc.issued_general, gtc.issued_junior, gtc.issued_other
  INTO v_capacity, v_junior_capacity, v_is_released, v_issued_general, v_issued_junior, v_issued_other
  FROM public.gym_ticket_counters gtc
  JOIN public.gym_performances gp ON gp.id = gtc.performance_id
  CROSS JOIN LATERAL (SELECT junior_release_open FROM public.configs ORDER BY id LIMIT 1) cfg
  WHERE gtc.performance_id = p_performance_id FOR UPDATE OF gtc;
  IF NOT FOUND THEN RAISE EXCEPTION 'gym ticket counter was not initialized'; END IF;

  IF v_is_released THEN
    v_general_remaining := greatest(v_capacity - v_issued_general - v_issued_junior - v_issued_other, 0);
    v_junior_remaining := v_general_remaining;
  ELSE
    v_general_remaining_raw := v_capacity - v_junior_capacity - v_issued_general - v_issued_other;
    v_general_remaining := greatest(v_general_remaining_raw, 0);
    v_junior_remaining := greatest(v_junior_capacity - v_issued_junior - greatest(-v_general_remaining_raw, 0), 0);
  END IF;

  IF p_ticket_type_id = 6 THEN
    IF v_junior_remaining < v_need THEN RAISE EXCEPTION '中学生用の予約枠が上限に達しました。'; END IF;
  ELSIF p_ticket_type_id IN (3, 9) THEN
    IF v_general_remaining < v_need THEN RAISE EXCEPTION '招待券用の残席がありません。'; END IF;
  ELSIF v_general_remaining + v_junior_remaining < v_need THEN
    RAISE EXCEPTION '体育館公演の定員を超過しています。';
  END IF;

  UPDATE public.gym_ticket_counters SET
    issued_count = issued_count + v_need,
    issued_general = issued_general + CASE WHEN p_ticket_type_id IN (3, 9) THEN v_need ELSE 0 END,
    issued_junior = issued_junior + CASE WHEN p_ticket_type_id = 6 THEN v_need ELSE 0 END,
    issued_other = issued_other + CASE WHEN p_ticket_type_id NOT IN (3, 6, 9) THEN v_need ELSE 0 END,
    updated_at = now()
  WHERE performance_id = p_performance_id;

  FOR i IN 1..p_issue_count LOOP
    INSERT INTO public.tickets (user_id, ticket_type, relationship, status, code, signature, person_count)
    VALUES (p_user_id, p_ticket_type_id, p_relationship_id, 'valid', p_codes[i], p_signatures[i], p_person_count)
    RETURNING id INTO v_ticket_id;
    INSERT INTO public.gym_tickets (id, performance_id) VALUES (v_ticket_id, p_performance_id);
  END LOOP;
  RETURN QUERY SELECT unnest(p_codes), unnest(p_signatures);
END;
$$;


ALTER FUNCTION "public"."issue_gym_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" smallint, "p_relationship_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."issue_junior_id"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  next_id integer;
  min_id integer := 100001;
  max_id integer := 103839;
BEGIN
  LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE;

  SELECT coalesce(max(affiliation), min_id - 1) + 1
    INTO next_id
  FROM public.users
  WHERE role = 'junior';

  -- affiliation - 100000 の Bit6..9 が 1111 の範囲は当日券用欠番。
  WHILE next_id <= max_id
    AND (((next_id - 100000) >> 6) & 15) = 15 LOOP
    next_id := next_id + 1;
  END LOOP;

  IF next_id > max_id THEN
    RAISE EXCEPTION 'ID_LIMIT_REACHED';
  END IF;

  RETURN next_id;
END;
$$;


ALTER FUNCTION "public"."issue_junior_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_junior_application_day"("p_application_day" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $_$
DECLARE
  normalized_application_day text;
  class_day_value text;
  gym_day_value text;
BEGIN
  IF p_application_day IS NULL THEN
    RETURN NULL;
  END IF;

  normalized_application_day := trim(p_application_day);
  IF normalized_application_day = '' THEN
    RETURN NULL;
  END IF;

  IF normalized_application_day ~* '^admission_only(=true)?$' THEN
    RETURN 'admission_only';
  END IF;

  IF normalized_application_day ~* '^((class_day|gym_day)=.+)(;((class_day|gym_day)=.+))*$' THEN
    class_day_value := null;
    gym_day_value := null;

    SELECT split_part(value_pair, '=', 2)
      INTO class_day_value
    FROM regexp_split_to_table(normalized_application_day, ';') AS value_pair
    WHERE split_part(value_pair, '=', 1) = 'class_day'
    LIMIT 1;

    SELECT split_part(value_pair, '=', 2)
      INTO gym_day_value
    FROM regexp_split_to_table(normalized_application_day, ';') AS value_pair
    WHERE split_part(value_pair, '=', 1) = 'gym_day'
    LIMIT 1;

    IF class_day_value IS NOT NULL OR gym_day_value IS NOT NULL THEN
      class_day_value := trim(coalesce(class_day_value, ''));
      gym_day_value := trim(coalesce(gym_day_value, ''));

      IF class_day_value ~* '^admission_only(=true)?$'
         AND gym_day_value ~* '^admission_only(=true)?$' THEN
        RETURN 'admission_only';
      END IF;
    END IF;
  END IF;

  IF normalized_application_day ~* '^(day1|day2|1|2)(\&(day1|day2|1|2))*$'
     OR normalized_application_day ~* '^(((class_day|gym_day)=(day1|day2|1|2)(\&(day1|day2|1|2))*)(;((class_day|gym_day)=(day1|day2|1|2)(\&(day1|day2|1|2))*))*)$' THEN
    RETURN lower(normalized_application_day);
  END IF;

  RAISE EXCEPTION 'INVALID_APPLICATION_DAY';
END;
$_$;


ALTER FUNCTION "public"."normalize_junior_application_day"("p_application_day" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_duplicate_self_class_invite"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid;
  v_relationship_id integer;
  v_ticket_type_id integer;
BEGIN
  SELECT user_id, relationship, ticket_type
    INTO v_user_id, v_relationship_id, v_ticket_type_id
    FROM public.tickets
   WHERE id = NEW.id;

  IF v_user_id = '00000000-0000-0000-0000-00000000d001'::uuid
     OR v_relationship_id IS DISTINCT FROM 1
     OR NOT EXISTS (
       SELECT 1
         FROM public.ticket_types
        WHERE id = v_ticket_type_id
          AND (
            (name = 'クラス公演(当日)' AND type = '招待券')
            OR (name = 'クラス公演' AND type = '当日券')
          )
     ) THEN
    RETURN NEW;
  END IF;

  -- 同じ利用者・公演回の発券を直列化し、同時送信によるすり抜けを防ぐ。
  PERFORM pg_advisory_xact_lock(
    hashtext(v_user_id::text || ':' || NEW.round_id::text)
  );

  IF EXISTS (
    SELECT 1
      FROM public.tickets AS t
      JOIN public.class_tickets AS ct ON ct.id = t.id
     WHERE t.user_id = v_user_id
       AND t.status = 'valid'
       AND t.relationship = 1
       AND ct.round_id = NEW.round_id
       AND ct.class_id <> NEW.class_id
  ) THEN
    RAISE EXCEPTION
      '同じ公演回の別クラス公演について、本人分のチケットが既に発券されています。';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_duplicate_self_class_invite"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_student_ticket_issue_counter"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE owner_id uuid;
DECLARE target_id smallint;
BEGIN
  SELECT user_id INTO owner_id FROM public.tickets WHERE id = NEW.id AND status = 'valid';
  target_id := CASE WHEN TG_ARGV[0] = 'class' THEN (to_jsonb(NEW)->>'class_id')::smallint ELSE (to_jsonb(NEW)->>'performance_id')::smallint END;
  IF owner_id IS NOT NULL AND target_id IS NOT NULL THEN
    INSERT INTO public.student_ticket_issue_counters(user_id, performance_type, performance_id, issued_count)
    VALUES (owner_id, TG_ARGV[0], target_id, 1)
    ON CONFLICT (user_id, performance_type, performance_id)
    DO UPDATE SET issued_count = public.student_ticket_issue_counters.issued_count + 1;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION "public"."refresh_student_ticket_issue_counter"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_junior"("junior_usage_type" smallint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  next_affiliation integer;
begin
  if junior_usage_type < 0 or junior_usage_type > 3 then
    raise exception 'INVALID_JUNIOR_USAGE_TYPE';
  end if;

  next_affiliation := public.issue_junior_id();

  insert into public.users (id, email, affiliation, role, clubs, junior_usage_type)
  values (
    auth.uid(),
    (select email from auth.users where id = auth.uid()),
    next_affiliation,
    'junior',
    null,
    junior_usage_type
  );
end;
$$;


ALTER FUNCTION "public"."register_junior"("junior_usage_type" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_junior"("junior_usage_type" smallint, "p_application_day" "text" DEFAULT NULL::"text", "p_secret_code" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  next_affiliation integer;
  normalized_application_day text;
  v_hashed_password text;
begin
  if junior_usage_type < 0 or junior_usage_type > 3 then
    raise exception 'INVALID_JUNIOR_USAGE_TYPE';
  end if;

  select junior_password into v_hashed_password
  from public.configs
  limit 1;

  if v_hashed_password is null or v_hashed_password = '' then
    raise exception '合言葉が設定されていません。管理者にお問い合わせください。';
  end if;

  if v_hashed_password != extensions.crypt(p_secret_code, v_hashed_password) then
    raise exception '合言葉が正しくありません。';
  end if;

  normalized_application_day := public.normalize_junior_application_day(p_application_day);

  next_affiliation := public.issue_junior_id();

  insert into public.users (id, email, affiliation, role, clubs, junior_usage_type, application_day)
  values (
    auth.uid(),
    (select email from auth.users where id = auth.uid()),
    next_affiliation,
    'junior',
    null,
    junior_usage_type,
    normalized_application_day
  );
end;
$$;


ALTER FUNCTION "public"."register_junior"("junior_usage_type" smallint, "p_application_day" "text", "p_secret_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_student"("affiliation" integer, "clubs" "text"[] DEFAULT NULL::"text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
  INSERT INTO public.users (
    id,
    email,
    affiliation,
    role,
    clubs,
    account_confirmed
  )
  VALUES (
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    affiliation,
    'student',
    clubs,
    true
  );
END;
$$;


ALTER FUNCTION "public"."register_student"("affiliation" integer, "clubs" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reissue_gym_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint DEFAULT 1) RETURNS TABLE("code" "text", "signature" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$declare
  v_ticket_id uuid;
  v_owner_id uuid;
  v_status public.ticket_status;
  v_ticket_type smallint;
  v_performance_id smallint;
begin
  if p_user_id is null then
    raise exception 'user is required';
  end if;

  if p_old_code is null or length(trim(p_old_code)) = 0 then
    raise exception 'old_code is required';
  end if;

  if p_issue_count is null or p_issue_count <> 1 then
    raise exception 'issue_count must be 1';
  end if;

  if p_codes is null or p_signatures is null then
    raise exception 'codes/signatures are required';
  end if;

  if array_length(p_codes, 1) is distinct from p_issue_count
     or array_length(p_signatures, 1) is distinct from p_issue_count then
    raise exception 'codes/signatures length mismatch';
  end if;

  if p_new_relationship_id is null or p_new_relationship_id <= 0 then
    raise exception 'new_relationship_id must be positive';
  end if;

  if p_performance_id <= 0 or p_schedule_id <> 0 then
    raise exception 'gym ticket reissue requires performance_id > 0 and schedule_id = 0';
  end if;

  select t.id, t.user_id, t.status, t.ticket_type
    into v_ticket_id, v_owner_id, v_status, v_ticket_type
  from public.tickets as t
  where t.code = p_old_code
  limit 1
  for update;

  if not found then
    raise exception 'ticket not found';
  end if;

  if v_status is distinct from 'valid' then
    raise exception 'only valid tickets can be reissued';
  end if;

  if v_ticket_type is distinct from p_ticket_type_id then
    raise exception 'ticket_type mismatch';
  end if;

  select performance_id
    into v_performance_id
  from public.gym_tickets
  where id = v_ticket_id
  limit 1
  for update;

  if not found then
    raise exception 'gym ticket mapping not found';
  end if;

  if v_performance_id is distinct from p_performance_id then
    raise exception 'performance mismatch';
  end if;

  update public.tickets
    set status = 'cancelled', updated_at = now()
  where id = v_ticket_id;

  return query
    select it.code, it.signature
    from public.issue_gym_tickets_with_codes(
      p_user_id,
      p_ticket_type_id,
      p_new_relationship_id,
      p_performance_id,
      p_schedule_id,
      p_issue_count,
      p_codes,
      p_signatures,
      p_person_count
    ) as it;
end;$$;


ALTER FUNCTION "public"."reissue_gym_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reissue_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint DEFAULT 1) RETURNS TABLE("code" "text", "signature" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$declare
  v_ticket_id uuid;
  v_owner_id uuid;
  v_status public.ticket_status;
  v_ticket_type smallint;
  v_class_id smallint;
  v_round_id smallint;
begin
  if p_user_id is null then
    raise exception 'user is required';
  end if;

  if p_old_code is null or length(trim(p_old_code)) = 0 then
    raise exception 'old_code is required';
  end if;

  if p_issue_count is null or p_issue_count <> 1 then
    raise exception 'issue_count must be 1';
  end if;

  if p_codes is null or p_signatures is null then
    raise exception 'codes/signatures are required';
  end if;

  if array_length(p_codes, 1) is distinct from p_issue_count
     or array_length(p_signatures, 1) is distinct from p_issue_count then
    raise exception 'codes/signatures length mismatch';
  end if;

  if p_new_relationship_id is null or p_new_relationship_id <= 0 then
    raise exception 'new_relationship_id must be positive';
  end if;

  select t.id, t.user_id, t.status, t.ticket_type
    into v_ticket_id, v_owner_id, v_status, v_ticket_type
  from public.tickets as t
  where t.code = p_old_code
  limit 1
  for update;

  if not found then
    raise exception 'ticket not found';
  end if;

  if v_status is distinct from 'valid' then
    raise exception 'only valid tickets can be reissued';
  end if;

  if v_ticket_type is distinct from p_ticket_type_id then
    raise exception 'ticket_type mismatch';
  end if;

  if p_ticket_type_id = 4 or p_ticket_type_id = 7 then
    if p_performance_id <> 0 or p_schedule_id <> 0 then
      raise exception 'admission-only ticket requires performanceId=0 and scheduleId=0';
    end if;
  else
    select class_id, round_id
      into v_class_id, v_round_id
    from public.class_tickets
    where id = v_ticket_id
    limit 1
    for update;

    if not found then
      raise exception 'class ticket mapping not found';
    end if;

    if v_class_id is distinct from p_performance_id or v_round_id is distinct from p_schedule_id then
      raise exception 'performance/schedule mismatch';
    end if;
  end if;

  update public.tickets
    set status = 'cancelled', updated_at = now()
  where id = v_ticket_id;

  return query
    select it.code, it.signature
    from public.issue_class_tickets_with_codes(
      p_user_id,
      p_ticket_type_id,
      p_new_relationship_id,
      p_performance_id,
      p_schedule_id,
      p_issue_count,
      p_codes,
      p_signatures,
      p_person_count
    ) as it;
end;$$;


ALTER FUNCTION "public"."reissue_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rollback_ticket_code_counter"("p_prefix" "text", "p_decrement" integer, "p_expected_last_value" bigint) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_applied boolean;
begin
  if p_prefix is null or length(trim(p_prefix)) = 0 then
    raise exception 'prefix is required';
  end if;

  if p_decrement is null or p_decrement <= 0 then
    raise exception 'decrement must be positive';
  end if;

  if p_expected_last_value is null or p_expected_last_value < 0 then
    raise exception 'expected_last_value must be non-negative';
  end if;

  -- 巻き戻しは「このリクエストが更新した直後の値」のときだけ適用する。
  -- 他トランザクションで値が進んでいる場合は false を返し、カウンタを壊さない。
  update public.ticket_code_counters
  set
    last_value = last_value - p_decrement,
    updated_at = now()
  where prefix = p_prefix
    and last_value = p_expected_last_value
    and last_value - p_decrement >= 0
  returning true into v_applied;

  return coalesce(v_applied, false);
end;
$$;


ALTER FUNCTION "public"."rollback_ticket_code_counter"("p_prefix" "text", "p_decrement" integer, "p_expected_last_value" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_ticket_name"("ticket_code" "text", "ticket_signature" "text", "new_ticket_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF new_ticket_name IS NOT NULL AND (
    char_length(new_ticket_name) > 100
    OR char_length(btrim(new_ticket_name)) = 0
  ) THEN
    RAISE EXCEPTION 'チケット名は1〜100文字で入力してください。';
  END IF;

  UPDATE public.tickets AS ticket
  SET
    ticket_name = NULLIF(btrim(new_ticket_name), ''),
    updated_at = now()
  WHERE ticket.code = ticket_code
    AND ticket.signature = ticket_signature;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'チケットが見つからないか、署名が正しくありません。';
  END IF;
END;
$$;


ALTER FUNCTION "public"."set_ticket_name"("ticket_code" "text", "ticket_signature" "text", "new_ticket_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."split_and_register_junior"("p_parent_auth_id" "uuid", "p_parent_email" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
    v_junior_id uuid := auth.uid();
    v_junior_email text;
    next_junior_affiliation integer;
    next_parent_affiliation integer;
BEGIN
    -- 1. ログイン済みかチェック
    IF v_junior_id IS NULL THEN
        RAISE EXCEPTION '認証されていません。再ログインしてください。';
    END IF;

    -- 2. 中学生(自分)が public.users に既に登録がないかチェック
    IF EXISTS (SELECT 1 FROM public.users WHERE id = v_junior_id) THEN
        RAISE EXCEPTION 'このユーザーは既に登録済みです。';
    END IF;

    -- 3. 現在の中学生(ログイン中)のメールアドレス取得
    SELECT email INTO v_junior_email FROM auth.users WHERE id = v_junior_id;

    -- 4. 中学生用の affiliation (ID) 発行
    next_junior_affiliation := public.issue_junior_id();

    -- 5. 中学生（自分）を public.users に登録 (junior_usage_type = 2: 中学生のみ)
    INSERT INTO public.users (id, email, affiliation, role, clubs, junior_usage_type)
    VALUES (v_junior_id, v_junior_email, next_junior_affiliation, 'junior', null, 2);

    -- 6. 保護者用の affiliation (ID) 発行
    next_parent_affiliation := public.issue_junior_id();

    -- 7. 保護者を public.users に登録 (junior_usage_type = 3: 保護者のみ)
    -- クライアントから渡された p_parent_auth_id を使用
    INSERT INTO public.users (id, email, affiliation, role, clubs, junior_usage_type)
    VALUES (p_parent_auth_id, p_parent_email, next_parent_affiliation, 'junior', null, 3);

    -- 注意: auth.identities などの認証データはクライアント側の signUp で自動生成されるためここでは不要
END;
$$;


ALTER FUNCTION "public"."split_and_register_junior"("p_parent_auth_id" "uuid", "p_parent_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."split_and_register_junior"("p_parent_auth_id" "uuid", "p_parent_email" "text", "p_application_day" "text" DEFAULT NULL::"text", "p_secret_code" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
  v_junior_id uuid := auth.uid();
  v_junior_email text;
  next_junior_affiliation integer;
  next_parent_affiliation integer;
  normalized_application_day text;
  v_hashed_password text;
BEGIN
  IF v_junior_id IS NULL THEN
    RAISE EXCEPTION '認証されていません。再ログインしてください。';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = v_junior_id) THEN
    RAISE EXCEPTION 'このユーザーは既に登録済みです。';
  END IF;

  SELECT junior_password INTO v_hashed_password FROM public.configs LIMIT 1;
  IF v_hashed_password IS NULL OR v_hashed_password = '' THEN
    RAISE EXCEPTION '合言葉が設定されていません。管理者にお問い合わせください。';
  END IF;
  IF v_hashed_password != extensions.crypt(p_secret_code, v_hashed_password) THEN
    RAISE EXCEPTION '合言葉が正しくありません。';
  END IF;

  normalized_application_day := public.normalize_junior_application_day(p_application_day);
  SELECT email INTO v_junior_email FROM auth.users WHERE id = v_junior_id;

  next_junior_affiliation := public.issue_junior_id();
  INSERT INTO public.users (id, email, affiliation, role, clubs, junior_usage_type, application_day)
  VALUES (v_junior_id, v_junior_email, next_junior_affiliation, 'junior', null, 2, normalized_application_day);

  next_parent_affiliation := public.issue_junior_id();
  INSERT INTO public.users (id, email, affiliation, role, clubs, junior_usage_type, application_day)
  VALUES (p_parent_auth_id, p_parent_email, next_parent_affiliation, 'junior', null, 3, normalized_application_day);

  UPDATE public.junior_account_split_counters
  SET separate_on_registration_count = separate_on_registration_count + 1
  WHERE id = 1;
END;
$$;


ALTER FUNCTION "public"."split_and_register_junior"("p_parent_auth_id" "uuid", "p_parent_email" "text", "p_application_day" "text", "p_secret_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."split_existing_junior_account"("p_parent_auth_id" "uuid", "p_parent_email" "text", "p_application_day" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
  v_junior_id uuid := auth.uid();
  v_current_usage_type integer;
  v_current_application_day text;
  next_parent_affiliation integer;
BEGIN
  IF v_junior_id IS NULL THEN
    RAISE EXCEPTION '認証されていません。再ログインしてください。';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_junior_id) THEN
    RAISE EXCEPTION 'このユーザーは登録されていません。';
  END IF;

  SELECT junior_usage_type, application_day
  INTO v_current_usage_type, v_current_application_day
  FROM public.users WHERE id = v_junior_id;
  IF v_current_usage_type != 0 THEN
    RAISE EXCEPTION 'このアカウントは分割できません。現在の利用形態: %', v_current_usage_type;
  END IF;

  UPDATE public.tickets SET status = 'cancelled'
  WHERE user_id = v_junior_id AND status = 'valid';
  UPDATE public.users
  SET junior_usage_type = 2,
      application_day = COALESCE(p_application_day, v_current_application_day)
  WHERE id = v_junior_id;

  next_parent_affiliation := public.issue_junior_id();
  INSERT INTO public.users (id, email, affiliation, role, clubs, junior_usage_type, application_day)
  VALUES (p_parent_auth_id, p_parent_email, next_parent_affiliation, 'junior', null, 3, COALESCE(p_application_day, v_current_application_day));

  UPDATE public.junior_account_split_counters
  SET later_split_count = later_split_count + 1
  WHERE id = 1;
END;
$$;


ALTER FUNCTION "public"."split_existing_junior_account"("p_parent_auth_id" "uuid", "p_parent_email" "text", "p_application_day" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_admission_only_junior_account_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.junior_admission_only_account_counts
  SET admission_only_count = (
    SELECT COUNT(*)
    FROM public.users
    WHERE application_day = 'admission_only'
      AND role = 'junior'
  )
  WHERE id = 1;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_admission_only_junior_account_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_student_ticket_issue_counter_on_ticket_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  owner_id uuid;
  target_id smallint;
  counter_type text;
  delta integer;
BEGIN
  owner_id := coalesce(NEW.user_id, OLD.user_id);
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.status = 'valid' AND NEW.status <> 'valid') THEN
    delta := -1;
  ELSIF TG_OP = 'UPDATE' AND OLD.status <> 'valid' AND NEW.status = 'valid' THEN
    delta := 1;
  ELSE
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT 'class', class_id INTO counter_type, target_id FROM public.class_tickets WHERE id = coalesce(NEW.id, OLD.id);
  IF counter_type IS NULL THEN
    SELECT 'gym', performance_id INTO counter_type, target_id FROM public.gym_tickets WHERE id = coalesce(NEW.id, OLD.id);
  END IF;

  IF owner_id IS NOT NULL AND counter_type IS NOT NULL THEN
    INSERT INTO public.student_ticket_issue_counters(user_id, performance_type, performance_id, issued_count)
    VALUES (owner_id, counter_type, target_id, greatest(delta, 0))
    ON CONFLICT (user_id, performance_type, performance_id)
    DO UPDATE SET issued_count = greatest(public.student_ticket_issue_counters.issued_count + delta, 0);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;


ALTER FUNCTION "public"."sync_student_ticket_issue_counter_on_ticket_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_admission_only_junior_account_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  current_count integer;
  max_count integer;
  next_day text;
BEGIN
  next_day := public.normalize_junior_application_day(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.application_day ELSE NEW.application_day END
  );
  IF next_day IS DISTINCT FROM 'admission_only' THEN
    RETURN NEW;
  END IF;

  SELECT admission_only_count INTO current_count
  FROM public.junior_admission_only_account_counts
  WHERE id = 1;

  SELECT max_admission_only_junior_accounts INTO max_count
  FROM public.configs
  WHERE id = 1;

  IF max_count IS NOT NULL AND max_count >= 0 AND current_count >= max_count THEN
    RAISE EXCEPTION 'ADMISSION_ONLY_JUNIOR_ACCOUNT_LIMIT_REACHED';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_admission_only_junior_account_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_junior_secret_code"("p_secret_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'auth'
    AS $$
DECLARE
  v_hashed_password text;
BEGIN
  SELECT junior_password INTO v_hashed_password
  FROM public.configs
  LIMIT 1;

  IF v_hashed_password IS NULL OR v_hashed_password = '' THEN
    RETURN false;
  END IF;

  IF v_hashed_password = extensions.crypt(p_secret_code, v_hashed_password) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;


ALTER FUNCTION "public"."validate_junior_secret_code"("p_secret_code" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."admin_auth_rate_limits" (
    "ip_address" "text" NOT NULL,
    "failed_attempts" integer DEFAULT 0 NOT NULL,
    "last_failed_at" timestamp with time zone,
    "locked_until" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "admin_auth_rate_limits_failed_attempts_check" CHECK (("failed_attempts" >= 0))
);


ALTER TABLE "public"."admin_auth_rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "admin_sessions_expires_after_created" CHECK (("expires_at" > "created_at"))
);


ALTER TABLE "public"."admin_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."class_performances" (
    "year" smallint,
    "class_name" "text",
    "title" "text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "junior_capacity" smallint DEFAULT '10'::smallint,
    "total_capacity" smallint DEFAULT '50'::smallint,
    "id" smallint NOT NULL,
    "is_accepting" boolean DEFAULT true,
    "image_path" "text",
    "max_tickets_per_user" smallint DEFAULT 20 NOT NULL,
    CONSTRAINT "class_performances_max_tickets_per_user_check" CHECK ((("max_tickets_per_user" >= 0) AND ("max_tickets_per_user" <= 100)))
);


ALTER TABLE "public"."class_performances" OWNER TO "postgres";


ALTER TABLE "public"."class_performances" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."class_performances_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."class_ticket_counters" (
    "class_id" smallint NOT NULL,
    "round_id" smallint NOT NULL,
    "issued_general" integer DEFAULT 0 NOT NULL,
    "issued_junior" integer DEFAULT 0 NOT NULL,
    "issued_other" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "class_ticket_counters_issued_general_check" CHECK (("issued_general" >= 0)),
    CONSTRAINT "class_ticket_counters_issued_junior_check" CHECK (("issued_junior" >= 0)),
    CONSTRAINT "class_ticket_counters_issued_other_check" CHECK (("issued_other" >= 0))
);


ALTER TABLE "public"."class_ticket_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."class_tickets" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "class_id" smallint NOT NULL,
    "round_id" smallint NOT NULL
);


ALTER TABLE "public"."class_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configs" (
    "id" integer DEFAULT 1 NOT NULL,
    "event_year" integer DEFAULT 2025 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "admin_password" "text" DEFAULT 'admin123'::"text" NOT NULL,
    "show_length" smallint DEFAULT '60'::smallint NOT NULL,
    "junior_release_open" boolean DEFAULT false NOT NULL,
    "max_tickets_per_junior_user" smallint DEFAULT '1'::smallint NOT NULL,
    "junior_password" "text",
    "max_admission_only_junior_accounts" integer DEFAULT 0 NOT NULL,
    "gym_ticket_limits_by_club" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "max_tickets_per_other_class_user" smallint DEFAULT 20 NOT NULL,
    "max_tickets_per_other_club_user" smallint DEFAULT 20 NOT NULL,
    "max_tickets_per_other_performance_user" smallint DEFAULT 40 NOT NULL,
    CONSTRAINT "configs_gym_ticket_limits_by_club_object_check" CHECK (("jsonb_typeof"("gym_ticket_limits_by_club") = 'object'::"text")),
    CONSTRAINT "configs_max_tickets_per_other_class_user_check" CHECK ((("max_tickets_per_other_class_user" >= 0) AND ("max_tickets_per_other_class_user" <= 100))),
    CONSTRAINT "configs_max_tickets_per_other_club_user_check" CHECK ((("max_tickets_per_other_club_user" >= 0) AND ("max_tickets_per_other_club_user" <= 100))),
    CONSTRAINT "configs_max_tickets_per_other_performance_user_check" CHECK ((("max_tickets_per_other_performance_user" >= 0) AND ("max_tickets_per_other_performance_user" <= 500))),
    CONSTRAINT "single_row" CHECK (("id" = 1))
);


ALTER TABLE "public"."configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exhibition_clubs" (
    "id" smallint NOT NULL,
    "group_name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "image_path" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "year" smallint DEFAULT 2026 NOT NULL
);


ALTER TABLE "public"."exhibition_clubs" OWNER TO "postgres";


ALTER TABLE "public"."exhibition_clubs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."exhibition_clubs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."flappy_leaderboard" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "player_name" "text" NOT NULL,
    "score" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."flappy_leaderboard" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gym_performances" (
    "id" smallint NOT NULL,
    "group_name" "text" NOT NULL,
    "round_name" "text" NOT NULL,
    "start_at" timestamp with time zone NOT NULL,
    "end_at" timestamp with time zone NOT NULL,
    "capacity" smallint NOT NULL,
    "year" smallint NOT NULL,
    "is_accepting" boolean DEFAULT true,
    "description" "text",
    "image_path" "text",
    "junior_capacity" smallint DEFAULT 50 NOT NULL,
    CONSTRAINT "gym_performances_junior_capacity_check" CHECK ((("junior_capacity" >= 0) AND ("junior_capacity" <= "capacity")))
);


ALTER TABLE "public"."gym_performances" OWNER TO "postgres";


ALTER TABLE "public"."gym_performances" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."gym_performances_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."gym_ticket_counters" (
    "performance_id" smallint NOT NULL,
    "issued_count" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "issued_general" integer DEFAULT 0 NOT NULL,
    "issued_junior" integer DEFAULT 0 NOT NULL,
    "issued_other" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "gym_ticket_counters_issued_count_check" CHECK (("issued_count" >= 0)),
    CONSTRAINT "gym_ticket_counters_issued_general_check" CHECK (("issued_general" >= 0)),
    CONSTRAINT "gym_ticket_counters_issued_junior_check" CHECK (("issued_junior" >= 0)),
    CONSTRAINT "gym_ticket_counters_issued_other_check" CHECK (("issued_other" >= 0))
);


ALTER TABLE "public"."gym_ticket_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gym_tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "performance_id" smallint NOT NULL
);


ALTER TABLE "public"."gym_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."junior_account_split_counters" (
    "id" integer DEFAULT 1 NOT NULL,
    "separate_on_registration_count" integer DEFAULT 0 NOT NULL,
    "later_split_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "junior_account_split_counters_single_row" CHECK (("id" = 1))
);


ALTER TABLE "public"."junior_account_split_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."junior_admission_only_account_counts" (
    "id" integer DEFAULT 1 NOT NULL,
    "admission_only_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "junior_admission_only_account_counts_single_row" CHECK (("id" = 1))
);


ALTER TABLE "public"."junior_admission_only_account_counts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."keep_alive" (
    "id" integer NOT NULL,
    "last_ping" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."keep_alive" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_admin_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_admin_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."organization_admin_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_admins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "username" "text" NOT NULL,
    "password_hash" "text" NOT NULL,
    "class_performance_id" smallint,
    "gym_performance_id" smallint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "exhibition_club_id" smallint,
    CONSTRAINT "organization_admins_one_performance" CHECK (((("class_performance_id" IS NOT NULL) AND ("gym_performance_id" IS NULL) AND ("exhibition_club_id" IS NULL)) OR (("class_performance_id" IS NULL) AND ("gym_performance_id" IS NOT NULL) AND ("exhibition_club_id" IS NULL)) OR (("class_performance_id" IS NULL) AND ("gym_performance_id" IS NULL) AND ("exhibition_club_id" IS NOT NULL))))
);


ALTER TABLE "public"."organization_admins" OWNER TO "postgres";


COMMENT ON TABLE "public"."organization_admins" IS '団体管理者。password_hash は bcrypt ハッシュを保存する。作成は運営管理者が行う。';



CREATE TABLE IF NOT EXISTS "public"."performances_schedule" (
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "start_at" timestamp with time zone NOT NULL,
    "id" smallint NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "round_name" "text" NOT NULL
);


ALTER TABLE "public"."performances_schedule" OWNER TO "postgres";


ALTER TABLE "public"."performances_schedule" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."performances_schedule_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."rehearsals" (
    "id" smallint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "class_id" smallint NOT NULL,
    "round_id" smallint,
    "round_name" "text" NOT NULL,
    "start_time" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "type" "public"."rehearsal_type" DEFAULT 'official'::"public"."rehearsal_type" NOT NULL
);


ALTER TABLE "public"."rehearsals" OWNER TO "postgres";


ALTER TABLE "public"."rehearsals" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."rehearsals_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."relationships" (
    "id" smallint NOT NULL,
    "name" "text",
    "is_accepting" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."relationships" OWNER TO "postgres";


ALTER TABLE "public"."relationships" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."relationships_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."student_ticket_issue_counters" (
    "user_id" "uuid" NOT NULL,
    "performance_type" "text" NOT NULL,
    "performance_id" smallint NOT NULL,
    "issued_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "student_ticket_issue_counters_issued_count_check" CHECK (("issued_count" >= 0)),
    CONSTRAINT "student_ticket_issue_counters_performance_type_check" CHECK (("performance_type" = ANY (ARRAY['class'::"text", 'gym'::"text"])))
);


ALTER TABLE "public"."student_ticket_issue_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ticket_code_counters" (
    "prefix" "text" NOT NULL,
    "last_value" bigint DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ticket_code_counters_last_value_check" CHECK (("last_value" >= 0))
);


ALTER TABLE "public"."ticket_code_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ticket_issue_controls" (
    "id" smallint DEFAULT 1 NOT NULL,
    "class_invite_mode" "text" DEFAULT 'open'::"text" NOT NULL,
    "rehearsal_invite_mode" "text" DEFAULT 'open'::"text" NOT NULL,
    "gym_invite_mode" "text" DEFAULT 'open'::"text" NOT NULL,
    "entry_only_mode" "text" DEFAULT 'open'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "same_day_class_mode" "text" DEFAULT 'open'::"text",
    "same_day_gym_mode" "text" DEFAULT 'open'::"text",
    "junior_class_mode" "text" DEFAULT 'open'::"text" NOT NULL,
    "junior_entry_only_mode" "text" DEFAULT 'open'::"text" NOT NULL,
    "junior_gym_mode" "text" DEFAULT 'open'::"text" NOT NULL,
    CONSTRAINT "ticket_issue_controls_class_invite_mode_check" CHECK (("class_invite_mode" = ANY (ARRAY['open'::"text", 'only-own'::"text", 'outside-own-self-only'::"text", 'public-rehearsals'::"text", 'auto'::"text", 'off'::"text"]))),
    CONSTRAINT "ticket_issue_controls_entry_only_mode_check" CHECK (("entry_only_mode" = ANY (ARRAY['open'::"text", 'only-own'::"text", 'public-rehearsals'::"text", 'auto'::"text", 'off'::"text"]))),
    CONSTRAINT "ticket_issue_controls_gym_invite_mode_check" CHECK (("gym_invite_mode" = ANY (ARRAY['open'::"text", 'only-own'::"text", 'outside-own-self-only'::"text", 'public-rehearsals'::"text", 'auto'::"text", 'off'::"text"]))),
    CONSTRAINT "ticket_issue_controls_id_check" CHECK (("id" = 1)),
    CONSTRAINT "ticket_issue_controls_junior_class_mode_check" CHECK (("junior_class_mode" = ANY (ARRAY['open'::"text", 'only-own'::"text", 'public-rehearsals'::"text", 'auto'::"text", 'off'::"text"]))),
    CONSTRAINT "ticket_issue_controls_junior_entry_only_mode_check" CHECK (("junior_entry_only_mode" = ANY (ARRAY['open'::"text", 'only-own'::"text", 'public-rehearsals'::"text", 'auto'::"text", 'off'::"text"]))),
    CONSTRAINT "ticket_issue_controls_junior_gym_mode_check" CHECK (("junior_gym_mode" = ANY (ARRAY['open'::"text", 'only-own'::"text", 'public-rehearsals'::"text", 'auto'::"text", 'off'::"text"]))),
    CONSTRAINT "ticket_issue_controls_rehearsal_invite_mode_check" CHECK (("rehearsal_invite_mode" = ANY (ARRAY['open'::"text", 'only-own'::"text", 'public-rehearsals'::"text", 'auto'::"text", 'off'::"text"])))
);


ALTER TABLE "public"."ticket_issue_controls" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ticket_types" (
    "id" smallint NOT NULL,
    "name" "text",
    "type" "text"
);


ALTER TABLE "public"."ticket_types" OWNER TO "postgres";


ALTER TABLE "public"."ticket_types" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."ticket_types_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "ticket_type" smallint NOT NULL,
    "status" "public"."ticket_status" DEFAULT 'valid'::"public"."ticket_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "relationship" smallint NOT NULL,
    "signature" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "person_count" smallint DEFAULT 1 NOT NULL,
    "ticket_name" "text"
);


ALTER TABLE "public"."tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email" "text" NOT NULL,
    "affiliation" integer NOT NULL,
    "role" "text",
    "clubs" "text"[],
    "junior_usage_type" smallint,
    "application_day" "text",
    "account_confirmed" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."relationships"
    ADD CONSTRAINT "Relationships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_auth_rate_limits"
    ADD CONSTRAINT "admin_auth_rate_limits_pkey" PRIMARY KEY ("ip_address");



ALTER TABLE ONLY "public"."admin_sessions"
    ADD CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_sessions"
    ADD CONSTRAINT "admin_sessions_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."class_ticket_counters"
    ADD CONSTRAINT "class_ticket_counters_pkey" PRIMARY KEY ("class_id", "round_id");



ALTER TABLE ONLY "public"."class_tickets"
    ADD CONSTRAINT "class_tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configs"
    ADD CONSTRAINT "configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exhibition_clubs"
    ADD CONSTRAINT "exhibition_clubs_group_name_key" UNIQUE ("group_name");



ALTER TABLE ONLY "public"."exhibition_clubs"
    ADD CONSTRAINT "exhibition_clubs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flappy_leaderboard"
    ADD CONSTRAINT "flappy_leaderboard_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gym_performances"
    ADD CONSTRAINT "gym_performances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gym_ticket_counters"
    ADD CONSTRAINT "gym_ticket_counters_pkey" PRIMARY KEY ("performance_id");



ALTER TABLE ONLY "public"."gym_tickets"
    ADD CONSTRAINT "gym_tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."junior_account_split_counters"
    ADD CONSTRAINT "junior_account_split_counters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."junior_admission_only_account_counts"
    ADD CONSTRAINT "junior_admission_only_account_counts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."keep_alive"
    ADD CONSTRAINT "keep_alive_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_admin_sessions"
    ADD CONSTRAINT "organization_admin_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_admin_sessions"
    ADD CONSTRAINT "organization_admin_sessions_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."organization_admins"
    ADD CONSTRAINT "organization_admins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_admins"
    ADD CONSTRAINT "organization_admins_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."class_performances"
    ADD CONSTRAINT "performances_class_name_key" UNIQUE ("class_name");



ALTER TABLE ONLY "public"."class_performances"
    ADD CONSTRAINT "performances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."performances_schedule"
    ADD CONSTRAINT "performances_schedule_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rehearsals"
    ADD CONSTRAINT "rehearsals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_ticket_issue_counters"
    ADD CONSTRAINT "student_ticket_issue_counters_pkey" PRIMARY KEY ("user_id", "performance_type", "performance_id");



ALTER TABLE ONLY "public"."ticket_code_counters"
    ADD CONSTRAINT "ticket_code_counters_pkey" PRIMARY KEY ("prefix");



ALTER TABLE ONLY "public"."ticket_issue_controls"
    ADD CONSTRAINT "ticket_issue_controls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ticket_types"
    ADD CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_affiliation_key" UNIQUE ("affiliation");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "admin_auth_rate_limits_locked_until_idx" ON "public"."admin_auth_rate_limits" USING "btree" ("locked_until");



CREATE INDEX "admin_sessions_expires_at_idx" ON "public"."admin_sessions" USING "btree" ("expires_at");



CREATE INDEX "admin_sessions_revoked_at_idx" ON "public"."admin_sessions" USING "btree" ("revoked_at");



CREATE INDEX "class_performances_image_path_idx" ON "public"."class_performances" USING "btree" ("image_path");



CREATE INDEX "class_tickets_class_id_idx" ON "public"."class_tickets" USING "btree" ("class_id");



CREATE INDEX "class_tickets_class_round_id_idx" ON "public"."class_tickets" USING "btree" ("class_id", "round_id", "id");



CREATE INDEX "class_tickets_round_id_idx" ON "public"."class_tickets" USING "btree" ("round_id");



CREATE INDEX "gym_tickets_performance_id_id_idx" ON "public"."gym_tickets" USING "btree" ("performance_id", "id");



CREATE INDEX "gym_tickets_performance_id_idx" ON "public"."gym_tickets" USING "btree" ("performance_id");



CREATE INDEX "organization_admin_sessions_active_idx" ON "public"."organization_admin_sessions" USING "btree" ("token_hash", "expires_at") WHERE ("revoked_at" IS NULL);



CREATE INDEX "rehearsals_class_id_idx" ON "public"."rehearsals" USING "btree" ("class_id");



CREATE INDEX "student_ticket_issue_counters_lookup_idx" ON "public"."student_ticket_issue_counters" USING "btree" ("user_id", "performance_type");



CREATE INDEX "tickets_relationship_idx" ON "public"."tickets" USING "btree" ("relationship");



CREATE INDEX "tickets_ticket_type_idx" ON "public"."tickets" USING "btree" ("ticket_type");



CREATE INDEX "tickets_user_id_idx" ON "public"."tickets" USING "btree" ("user_id");



CREATE INDEX "tickets_user_valid_type_idx" ON "public"."tickets" USING "btree" ("user_id", "ticket_type") WHERE ("status" = 'valid'::"public"."ticket_status");



CREATE INDEX "tickets_valid_id_type_person_idx" ON "public"."tickets" USING "btree" ("id", "ticket_type", "person_count") WHERE ("status" = 'valid'::"public"."ticket_status");



CREATE OR REPLACE TRIGGER "class_tickets_capacity_counter_delete" BEFORE DELETE ON "public"."class_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."adjust_class_ticket_counter_for_mapping_delete"();



CREATE OR REPLACE TRIGGER "gym_tickets_capacity_counter_delete" BEFORE DELETE ON "public"."gym_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."adjust_gym_ticket_counter_for_mapping_delete"();



CREATE OR REPLACE TRIGGER "prevent_duplicate_self_class_invite" BEFORE INSERT ON "public"."class_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_duplicate_self_class_invite"();



CREATE OR REPLACE TRIGGER "refresh_student_class_ticket_issue_counter" AFTER INSERT ON "public"."class_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."refresh_student_ticket_issue_counter"('class');



CREATE OR REPLACE TRIGGER "refresh_student_gym_ticket_issue_counter" AFTER INSERT ON "public"."gym_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."refresh_student_ticket_issue_counter"('gym');



CREATE OR REPLACE TRIGGER "sync_student_ticket_counter_on_ticket_change" AFTER DELETE OR UPDATE OF "status" ON "public"."tickets" FOR EACH ROW EXECUTE FUNCTION "public"."sync_student_ticket_issue_counter_on_ticket_change"();



CREATE OR REPLACE TRIGGER "tickets_class_capacity_counter_update" AFTER UPDATE OF "status", "ticket_type", "person_count" ON "public"."tickets" FOR EACH ROW WHEN ((("old"."status" IS DISTINCT FROM "new"."status") OR ("old"."ticket_type" IS DISTINCT FROM "new"."ticket_type") OR ("old"."person_count" IS DISTINCT FROM "new"."person_count"))) EXECUTE FUNCTION "public"."adjust_class_ticket_counter_for_ticket_update"();



CREATE OR REPLACE TRIGGER "tickets_gym_capacity_counter_update" AFTER UPDATE OF "status", "person_count" ON "public"."tickets" FOR EACH ROW WHEN ((("old"."status" IS DISTINCT FROM "new"."status") OR ("old"."person_count" IS DISTINCT FROM "new"."person_count"))) EXECUTE FUNCTION "public"."adjust_gym_ticket_counter_for_ticket_update"();



CREATE OR REPLACE TRIGGER "trg_sync_admission_only_junior_account_count" AFTER INSERT OR DELETE OR UPDATE OF "application_day", "role" ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."sync_admission_only_junior_account_count"();



CREATE OR REPLACE TRIGGER "trg_validate_admission_only_junior_account_limit" BEFORE INSERT OR UPDATE OF "application_day" ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."validate_admission_only_junior_account_limit"();



ALTER TABLE ONLY "public"."class_ticket_counters"
    ADD CONSTRAINT "class_ticket_counters_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."class_performances"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_ticket_counters"
    ADD CONSTRAINT "class_ticket_counters_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "public"."performances_schedule"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_tickets"
    ADD CONSTRAINT "class_tickets_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."class_performances"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_tickets"
    ADD CONSTRAINT "class_tickets_id_fkey" FOREIGN KEY ("id") REFERENCES "public"."tickets"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_tickets"
    ADD CONSTRAINT "class_tickets_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "public"."performances_schedule"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gym_ticket_counters"
    ADD CONSTRAINT "gym_ticket_counters_performance_id_fkey" FOREIGN KEY ("performance_id") REFERENCES "public"."gym_performances"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gym_tickets"
    ADD CONSTRAINT "gym_tickets_id_fkey" FOREIGN KEY ("id") REFERENCES "public"."tickets"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gym_tickets"
    ADD CONSTRAINT "gym_tickets_performance_id_fkey" FOREIGN KEY ("performance_id") REFERENCES "public"."gym_performances"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_admin_sessions"
    ADD CONSTRAINT "organization_admin_sessions_organization_admin_id_fkey" FOREIGN KEY ("organization_admin_id") REFERENCES "public"."organization_admins"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_admins"
    ADD CONSTRAINT "organization_admins_class_performance_id_fkey" FOREIGN KEY ("class_performance_id") REFERENCES "public"."class_performances"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_admins"
    ADD CONSTRAINT "organization_admins_exhibition_club_id_fkey" FOREIGN KEY ("exhibition_club_id") REFERENCES "public"."exhibition_clubs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_admins"
    ADD CONSTRAINT "organization_admins_gym_performance_id_fkey" FOREIGN KEY ("gym_performance_id") REFERENCES "public"."gym_performances"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rehearsals"
    ADD CONSTRAINT "rehearsals_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."class_performances"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_ticket_issue_counters"
    ADD CONSTRAINT "student_ticket_issue_counters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_relationship_fkey" FOREIGN KEY ("relationship") REFERENCES "public"."relationships"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_ticket_type_fkey" FOREIGN KEY ("ticket_type") REFERENCES "public"."ticket_types"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



CREATE POLICY "Allow public insert access" ON "public"."flappy_leaderboard" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public read access" ON "public"."flappy_leaderboard" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."class_performances" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."class_ticket_counters" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."class_tickets" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."configs" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."exhibition_clubs" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."gym_performances" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."gym_ticket_counters" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."gym_tickets" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."junior_admission_only_account_counts" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."performances_schedule" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."rehearsals" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."relationships" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ticket_code_counters" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ticket_issue_controls" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ticket_types" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."tickets" FOR SELECT USING (true);



CREATE POLICY "Enable read access for no users" ON "public"."admin_auth_rate_limits" FOR SELECT USING (false);



CREATE POLICY "Enable read access for no users" ON "public"."admin_sessions" FOR SELECT USING (false);



CREATE POLICY "Enable users to view their own data only" ON "public"."users" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id"));



ALTER TABLE "public"."admin_auth_rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "allow anon update keep alive" ON "public"."keep_alive" FOR UPDATE TO "anon" USING (("id" = 1)) WITH CHECK (("id" = 1));



CREATE POLICY "allow anon upsert keep alive" ON "public"."keep_alive" FOR INSERT TO "anon" WITH CHECK (("id" = 1));



ALTER TABLE "public"."class_performances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."class_ticket_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."class_tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exhibition_clubs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."flappy_leaderboard" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gym_performances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gym_ticket_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gym_tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."junior_account_split_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."junior_admission_only_account_counts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."keep_alive" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_admin_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_admins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."performances_schedule" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rehearsals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."relationships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_ticket_issue_counters" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_ticket_issue_counters_self_read" ON "public"."student_ticket_issue_counters" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."ticket_code_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ticket_issue_controls" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ticket_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";





























































































































































































GRANT ALL ON FUNCTION "public"."adjust_class_ticket_counter_for_mapping_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."adjust_class_ticket_counter_for_mapping_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."adjust_class_ticket_counter_for_mapping_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."adjust_class_ticket_counter_for_ticket_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."adjust_class_ticket_counter_for_ticket_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."adjust_class_ticket_counter_for_ticket_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."adjust_gym_ticket_counter_for_mapping_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."adjust_gym_ticket_counter_for_mapping_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."adjust_gym_ticket_counter_for_mapping_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."adjust_gym_ticket_counter_for_ticket_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."adjust_gym_ticket_counter_for_ticket_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."adjust_gym_ticket_counter_for_ticket_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_own_ticket_by_code"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_own_ticket_by_code"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_own_ticket_by_code"("p_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_student_account"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_student_account"() TO "anon";
GRANT ALL ON FUNCTION "public"."confirm_student_account"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_student_account"() TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."delete_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_admin_junior_status_dashboard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_admin_junior_status_dashboard"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_admin_junior_status_dashboard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admin_junior_status_dashboard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_admin_status_dashboard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_admin_status_dashboard"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_admin_status_dashboard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admin_status_dashboard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_admin_status_dashboard_base"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_admin_status_dashboard_base"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_admin_status_dashboard_base"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admin_status_dashboard_base"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_admission_only_junior_account_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_admission_only_junior_account_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admission_only_junior_account_count"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_junior_issue_bootstrap"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_junior_issue_bootstrap"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_junior_issue_bootstrap"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_junior_issue_bootstrap"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_junior_my_page"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_junior_my_page"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_junior_my_page"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_junior_my_page"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_performance_availability"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_performance_availability"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_performance_availability"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_performance_availability"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_public_performance_acceptance"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_performance_acceptance"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_performance_acceptance"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_performance_acceptance"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_student_class_ticket_remaining"("p_class_id" smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_student_class_ticket_remaining"("p_class_id" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."get_student_class_ticket_remaining"("p_class_id" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_student_class_ticket_remaining"("p_class_id" smallint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_student_dashboard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_student_dashboard"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_student_dashboard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_student_dashboard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_student_gym_ticket_remaining"("p_performance_id" smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_student_gym_ticket_remaining"("p_performance_id" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."get_student_gym_ticket_remaining"("p_performance_id" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_student_gym_ticket_remaining"("p_performance_id" smallint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_student_issue_bootstrap"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_student_issue_bootstrap"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_student_issue_bootstrap"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_student_issue_bootstrap"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_student_other_performance_total_remaining"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_student_other_performance_total_remaining"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_student_other_performance_total_remaining"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_student_other_performance_total_remaining"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_student_performance_ticket_remaining"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_student_performance_ticket_remaining"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_student_performance_ticket_remaining"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_student_performance_ticket_remaining"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_by_email"("user_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_by_email"("user_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_by_email"("user_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_by_email"("user_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_rank"("target_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_rank"("target_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_rank"("target_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."hash_password"("p_password" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hash_password"("p_password" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hash_password"("p_password" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_ticket_code_counter"("p_prefix" "text", "p_increment" integer, "p_max_value" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_ticket_code_counter"("p_prefix" "text", "p_increment" integer, "p_max_value" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_ticket_code_counter"("p_prefix" "text", "p_increment" integer, "p_max_value" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."issue_class_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" integer, "p_relationship_id" integer, "p_performance_id" integer, "p_schedule_id" integer, "p_issue_count" integer, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."issue_class_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" integer, "p_relationship_id" integer, "p_performance_id" integer, "p_schedule_id" integer, "p_issue_count" integer, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."issue_class_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" integer, "p_relationship_id" integer, "p_performance_id" integer, "p_schedule_id" integer, "p_issue_count" integer, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."issue_gym_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" smallint, "p_relationship_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."issue_gym_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" smallint, "p_relationship_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."issue_gym_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" smallint, "p_relationship_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."issue_junior_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."issue_junior_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."issue_junior_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_junior_application_day"("p_application_day" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_junior_application_day"("p_application_day" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_junior_application_day"("p_application_day" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_duplicate_self_class_invite"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_duplicate_self_class_invite"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_duplicate_self_class_invite"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_student_ticket_issue_counter"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_student_ticket_issue_counter"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_student_ticket_issue_counter"() TO "service_role";



GRANT ALL ON FUNCTION "public"."register_junior"("junior_usage_type" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."register_junior"("junior_usage_type" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_junior"("junior_usage_type" smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."register_junior"("junior_usage_type" smallint, "p_application_day" "text", "p_secret_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."register_junior"("junior_usage_type" smallint, "p_application_day" "text", "p_secret_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_junior"("junior_usage_type" smallint, "p_application_day" "text", "p_secret_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."register_student"("affiliation" integer, "clubs" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."register_student"("affiliation" integer, "clubs" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_student"("affiliation" integer, "clubs" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."reissue_gym_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."reissue_gym_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reissue_gym_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."reissue_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."reissue_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reissue_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rollback_ticket_code_counter"("p_prefix" "text", "p_decrement" integer, "p_expected_last_value" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."rollback_ticket_code_counter"("p_prefix" "text", "p_decrement" integer, "p_expected_last_value" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rollback_ticket_code_counter"("p_prefix" "text", "p_decrement" integer, "p_expected_last_value" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_ticket_name"("ticket_code" "text", "ticket_signature" "text", "new_ticket_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_ticket_name"("ticket_code" "text", "ticket_signature" "text", "new_ticket_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_ticket_name"("ticket_code" "text", "ticket_signature" "text", "new_ticket_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."split_and_register_junior"("p_parent_auth_id" "uuid", "p_parent_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."split_and_register_junior"("p_parent_auth_id" "uuid", "p_parent_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."split_and_register_junior"("p_parent_auth_id" "uuid", "p_parent_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."split_and_register_junior"("p_parent_auth_id" "uuid", "p_parent_email" "text", "p_application_day" "text", "p_secret_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."split_and_register_junior"("p_parent_auth_id" "uuid", "p_parent_email" "text", "p_application_day" "text", "p_secret_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."split_and_register_junior"("p_parent_auth_id" "uuid", "p_parent_email" "text", "p_application_day" "text", "p_secret_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."split_existing_junior_account"("p_parent_auth_id" "uuid", "p_parent_email" "text", "p_application_day" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."split_existing_junior_account"("p_parent_auth_id" "uuid", "p_parent_email" "text", "p_application_day" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."split_existing_junior_account"("p_parent_auth_id" "uuid", "p_parent_email" "text", "p_application_day" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_admission_only_junior_account_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_admission_only_junior_account_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_admission_only_junior_account_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_student_ticket_issue_counter_on_ticket_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_student_ticket_issue_counter_on_ticket_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_student_ticket_issue_counter_on_ticket_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_admission_only_junior_account_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_admission_only_junior_account_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_admission_only_junior_account_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_junior_secret_code"("p_secret_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."validate_junior_secret_code"("p_secret_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_junior_secret_code"("p_secret_code" "text") TO "service_role";
























GRANT MAINTAIN ON TABLE "public"."admin_auth_rate_limits" TO "anon";
GRANT MAINTAIN ON TABLE "public"."admin_auth_rate_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_auth_rate_limits" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."admin_sessions" TO "anon";
GRANT MAINTAIN ON TABLE "public"."admin_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."class_performances" TO "anon";
GRANT ALL ON TABLE "public"."class_performances" TO "authenticated";
GRANT ALL ON TABLE "public"."class_performances" TO "service_role";



GRANT ALL ON SEQUENCE "public"."class_performances_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."class_performances_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."class_performances_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."class_ticket_counters" TO "anon";
GRANT ALL ON TABLE "public"."class_ticket_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."class_ticket_counters" TO "service_role";



GRANT ALL ON TABLE "public"."class_tickets" TO "anon";
GRANT ALL ON TABLE "public"."class_tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."class_tickets" TO "service_role";



GRANT ALL ON TABLE "public"."configs" TO "anon";
GRANT ALL ON TABLE "public"."configs" TO "authenticated";
GRANT ALL ON TABLE "public"."configs" TO "service_role";



GRANT ALL ON TABLE "public"."exhibition_clubs" TO "anon";
GRANT ALL ON TABLE "public"."exhibition_clubs" TO "authenticated";
GRANT ALL ON TABLE "public"."exhibition_clubs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."exhibition_clubs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."exhibition_clubs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."exhibition_clubs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."flappy_leaderboard" TO "anon";
GRANT ALL ON TABLE "public"."flappy_leaderboard" TO "authenticated";
GRANT ALL ON TABLE "public"."flappy_leaderboard" TO "service_role";



GRANT ALL ON TABLE "public"."gym_performances" TO "anon";
GRANT ALL ON TABLE "public"."gym_performances" TO "authenticated";
GRANT ALL ON TABLE "public"."gym_performances" TO "service_role";



GRANT ALL ON SEQUENCE "public"."gym_performances_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."gym_performances_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."gym_performances_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."gym_ticket_counters" TO "anon";
GRANT ALL ON TABLE "public"."gym_ticket_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."gym_ticket_counters" TO "service_role";



GRANT ALL ON TABLE "public"."gym_tickets" TO "anon";
GRANT ALL ON TABLE "public"."gym_tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."gym_tickets" TO "service_role";



GRANT ALL ON TABLE "public"."junior_account_split_counters" TO "anon";
GRANT ALL ON TABLE "public"."junior_account_split_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."junior_account_split_counters" TO "service_role";



GRANT ALL ON TABLE "public"."junior_admission_only_account_counts" TO "anon";
GRANT ALL ON TABLE "public"."junior_admission_only_account_counts" TO "authenticated";
GRANT ALL ON TABLE "public"."junior_admission_only_account_counts" TO "service_role";



GRANT ALL ON TABLE "public"."keep_alive" TO "anon";
GRANT ALL ON TABLE "public"."keep_alive" TO "authenticated";
GRANT ALL ON TABLE "public"."keep_alive" TO "service_role";



GRANT ALL ON TABLE "public"."organization_admin_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."organization_admins" TO "service_role";



GRANT ALL ON TABLE "public"."performances_schedule" TO "anon";
GRANT ALL ON TABLE "public"."performances_schedule" TO "authenticated";
GRANT ALL ON TABLE "public"."performances_schedule" TO "service_role";



GRANT ALL ON SEQUENCE "public"."performances_schedule_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."performances_schedule_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."performances_schedule_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."rehearsals" TO "anon";
GRANT ALL ON TABLE "public"."rehearsals" TO "authenticated";
GRANT ALL ON TABLE "public"."rehearsals" TO "service_role";



GRANT ALL ON SEQUENCE "public"."rehearsals_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."rehearsals_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."rehearsals_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."relationships" TO "anon";
GRANT ALL ON TABLE "public"."relationships" TO "authenticated";
GRANT ALL ON TABLE "public"."relationships" TO "service_role";



GRANT ALL ON SEQUENCE "public"."relationships_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."relationships_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."relationships_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."student_ticket_issue_counters" TO "anon";
GRANT ALL ON TABLE "public"."student_ticket_issue_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."student_ticket_issue_counters" TO "service_role";



GRANT ALL ON TABLE "public"."ticket_code_counters" TO "anon";
GRANT ALL ON TABLE "public"."ticket_code_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."ticket_code_counters" TO "service_role";



GRANT ALL ON TABLE "public"."ticket_issue_controls" TO "anon";
GRANT ALL ON TABLE "public"."ticket_issue_controls" TO "authenticated";
GRANT ALL ON TABLE "public"."ticket_issue_controls" TO "service_role";



GRANT ALL ON TABLE "public"."ticket_types" TO "anon";
GRANT ALL ON TABLE "public"."ticket_types" TO "authenticated";
GRANT ALL ON TABLE "public"."ticket_types" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ticket_types_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ticket_types_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ticket_types_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tickets" TO "anon";
GRANT ALL ON TABLE "public"."tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."tickets" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































--
-- Dumped schema changes for auth and storage
--

CREATE POLICY "認証ユーザーのみアップロード可能" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK (("bucket_id" = 'performance-images'::"text"));



CREATE POLICY "誰でも画像の閲覧が可能" ON "storage"."objects" FOR SELECT USING (("bucket_id" = 'performance-images'::"text"));



