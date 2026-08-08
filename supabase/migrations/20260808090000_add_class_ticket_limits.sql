-- 自クラス向けの発行上限はクラス公演ごとに管理し、他クラス向けは共通設定で管理する。
ALTER TABLE public.class_performances
  ADD COLUMN IF NOT EXISTS max_tickets_per_user smallint;

UPDATE public.class_performances cp
SET max_tickets_per_user = c.max_tickets_per_user
FROM public.configs c
WHERE cp.max_tickets_per_user IS NULL;

ALTER TABLE public.class_performances
  ALTER COLUMN max_tickets_per_user SET NOT NULL,
  ALTER COLUMN max_tickets_per_user SET DEFAULT 20;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'class_performances_max_tickets_per_user_check'
      AND conrelid = 'public.class_performances'::regclass
  ) THEN
    ALTER TABLE public.class_performances
      ADD CONSTRAINT class_performances_max_tickets_per_user_check
      CHECK (max_tickets_per_user BETWEEN 0 AND 100);
  END IF;
END $$;

ALTER TABLE public.configs
  ADD COLUMN IF NOT EXISTS max_tickets_per_other_class_user smallint;

UPDATE public.configs
SET max_tickets_per_other_class_user = max_tickets_per_user
WHERE max_tickets_per_other_class_user IS NULL;

ALTER TABLE public.configs
  ALTER COLUMN max_tickets_per_other_class_user SET NOT NULL,
  ALTER COLUMN max_tickets_per_other_class_user SET DEFAULT 20;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'configs_max_tickets_per_other_class_user_check'
      AND conrelid = 'public.configs'::regclass
  ) THEN
    ALTER TABLE public.configs
      ADD CONSTRAINT configs_max_tickets_per_other_class_user_check
      CHECK (max_tickets_per_other_class_user BETWEEN 0 AND 100);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_student_class_ticket_remaining(p_class_id smallint)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, auth
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

REVOKE ALL ON FUNCTION public.get_student_class_ticket_remaining(smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_class_ticket_remaining(smallint) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_student_dashboard()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, auth AS $$
  WITH dashboard_user AS (
    SELECT id, affiliation, clubs, account_confirmed FROM public.users
    WHERE id = auth.uid() AND role = 'student'
  ), valid_tickets AS (
    SELECT id, code, signature, relationship, created_at, ticket_name
    FROM public.tickets WHERE user_id = auth.uid() AND status = 'valid'
  )
  SELECT jsonb_build_object(
    'profile', (SELECT to_jsonb(dashboard_user) FROM dashboard_user),
    'config', (SELECT jsonb_build_object(
      'is_active', is_active,
      'show_length', show_length,
      'max_tickets_per_other_class_user', max_tickets_per_other_class_user,
      'max_tickets_per_gym_user', max_tickets_per_gym_user,
      'gym_ticket_limits_by_club', gym_ticket_limits_by_club
    ) FROM public.configs ORDER BY id LIMIT 1),
    'controls', (SELECT jsonb_build_object(
      'class_invite_mode', class_invite_mode, 'rehearsal_invite_mode', rehearsal_invite_mode,
      'gym_invite_mode', gym_invite_mode, 'entry_only_mode', entry_only_mode
    ) FROM public.ticket_issue_controls WHERE id = 1),
    'class_ticket_count', (SELECT count(*) FROM public.class_tickets ct JOIN valid_tickets t ON t.id = ct.id),
    'gym_ticket_count', (SELECT count(*) FROM public.gym_tickets gt JOIN valid_tickets t ON t.id = gt.id),
    'tickets', coalesce((SELECT jsonb_agg(to_jsonb(valid_tickets) ORDER BY created_at DESC) FROM valid_tickets), '[]'::jsonb),
    'class_performances', coalesce((SELECT jsonb_agg(jsonb_build_object('id', cp.id, 'class_name', cp.class_name, 'title', cp.title)) FROM public.class_performances cp JOIN public.class_tickets ct ON ct.class_id = cp.id JOIN valid_tickets t ON t.id = ct.id), '[]'::jsonb),
    'gym_performances', coalesce((SELECT jsonb_agg(jsonb_build_object('id', gp.id, 'group_name', gp.group_name, 'round_name', gp.round_name, 'start_at', gp.start_at, 'end_at', gp.end_at)) FROM public.gym_performances gp JOIN public.gym_tickets gt ON gt.performance_id = gp.id JOIN valid_tickets t ON t.id = gt.id), '[]'::jsonb),
    'schedules', coalesce((SELECT jsonb_agg(jsonb_build_object('id', ps.id, 'start_at', ps.start_at)) FROM public.performances_schedule ps JOIN public.class_tickets ct ON ct.round_id = ps.id JOIN valid_tickets t ON t.id = ct.id), '[]'::jsonb)
  ) WHERE EXISTS (SELECT 1 FROM dashboard_user);
$$;

ALTER TABLE public.configs DROP COLUMN max_tickets_per_user;
