-- 部活別残数表示は合計上限と分離する。
CREATE OR REPLACE FUNCTION public.get_student_gym_ticket_remaining(p_performance_id smallint)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, auth AS $$
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

REVOKE ALL ON FUNCTION public.get_student_gym_ticket_remaining(smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_gym_ticket_remaining(smallint) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_student_other_performance_total_remaining()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, auth AS $$
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

REVOKE ALL ON FUNCTION public.get_student_other_performance_total_remaining() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_other_performance_total_remaining() TO authenticated;
