-- 他クラス・他部活をまたいだ合計発行上限。
ALTER TABLE public.configs
  ADD COLUMN IF NOT EXISTS max_tickets_per_other_performance_user smallint;

UPDATE public.configs
SET max_tickets_per_other_performance_user = max_tickets_per_other_class_user
WHERE max_tickets_per_other_performance_user IS NULL;

ALTER TABLE public.configs
  ALTER COLUMN max_tickets_per_other_performance_user SET NOT NULL,
  ALTER COLUMN max_tickets_per_other_performance_user SET DEFAULT 40;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'configs_max_tickets_per_other_performance_user_check'
      AND conrelid = 'public.configs'::regclass
  ) THEN
    ALTER TABLE public.configs
      ADD CONSTRAINT configs_max_tickets_per_other_performance_user_check
      CHECK (max_tickets_per_other_performance_user BETWEEN 0 AND 500);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_student_gym_ticket_remaining(p_performance_id smallint)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, auth AS $$
  WITH u AS (
    SELECT affiliation, coalesce(clubs, '{}'::text[]) AS clubs FROM public.users WHERE id = auth.uid() AND role = 'student'
  ), target AS (
    SELECT gp.group_name, gp.id FROM public.gym_performances gp WHERE gp.id = p_performance_id
  ), config AS (
    SELECT max_tickets_per_other_club_user, max_tickets_per_other_performance_user, gym_ticket_limits_by_club, max_tickets_per_other_class_user
    FROM public.configs ORDER BY id LIMIT 1
  ), group_ids AS (
    SELECT gp.id FROM public.gym_performances gp, target WHERE gp.group_name = target.group_name
  ), group_count AS (
    SELECT count(*)::integer AS value FROM public.tickets t JOIN public.gym_tickets gt ON gt.id = t.id
    WHERE t.user_id = auth.uid() AND t.status = 'valid' AND gt.performance_id IN (SELECT id FROM group_ids)
  ), other_class_ids AS (
    SELECT cp.id FROM public.class_performances cp, u
    WHERE cp.class_name <> concat(floor(u.affiliation / 10000), '-', floor((u.affiliation % 10000) / 100))
  ), other_gym_ids AS (
    SELECT gp.id FROM public.gym_performances gp, u
    WHERE NOT (gp.group_name = ANY(u.clubs))
  ), other_count AS (
    SELECT (
      (SELECT count(*) FROM public.tickets t JOIN public.class_tickets ct ON ct.id = t.id WHERE t.user_id = auth.uid() AND t.status = 'valid' AND ct.class_id IN (SELECT id FROM other_class_ids)) +
      (SELECT count(*) FROM public.tickets t JOIN public.gym_tickets gt ON gt.id = t.id WHERE t.user_id = auth.uid() AND t.status = 'valid' AND gt.performance_id IN (SELECT id FROM other_gym_ids))
    )::integer AS value
  )
  SELECT greatest(group_limit.value - group_count.value, 0)::integer
  FROM u CROSS JOIN target CROSS JOIN config CROSS JOIN group_count CROSS JOIN other_count
  CROSS JOIN LATERAL (SELECT CASE WHEN target.group_name = ANY(u.clubs)
    THEN coalesce((config.gym_ticket_limits_by_club ->> target.group_name)::integer, config.max_tickets_per_other_club_user)
    ELSE config.max_tickets_per_other_club_user END AS value) group_limit;
$$;

REVOKE ALL ON FUNCTION public.get_student_gym_ticket_remaining(smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_gym_ticket_remaining(smallint) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_student_dashboard()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, auth AS $$
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

ALTER TABLE public.configs DROP COLUMN IF EXISTS max_tickets_per_gym_user;
