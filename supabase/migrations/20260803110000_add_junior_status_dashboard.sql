-- Counters distinguish registrations made with separate junior/guardian
-- accounts from later splits. Historical rows cannot distinguish the origin,
-- so these counters start when this migration is applied.
CREATE TABLE IF NOT EXISTS public.junior_account_split_counters (
  id integer PRIMARY KEY DEFAULT 1,
  separate_on_registration_count integer NOT NULL DEFAULT 0,
  later_split_count integer NOT NULL DEFAULT 0,
  CONSTRAINT junior_account_split_counters_single_row CHECK (id = 1)
);

INSERT INTO public.junior_account_split_counters (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.split_and_register_junior(
  p_parent_auth_id uuid,
  p_parent_email text,
  p_application_day text DEFAULT NULL,
  p_secret_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
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

CREATE OR REPLACE FUNCTION public.split_existing_junior_account(
  p_parent_auth_id uuid,
  p_parent_email text,
  p_application_day text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
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

CREATE OR REPLACE FUNCTION public.get_admin_junior_status_dashboard()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
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

REVOKE ALL ON FUNCTION public.get_admin_junior_status_dashboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_junior_status_dashboard() TO service_role;
