-- The issue screen's aggregate remaining count must use the same rule as the
-- issuance API: rehearsal tickets do not consume the other-performance quota.
CREATE OR REPLACE FUNCTION public.get_student_other_performance_total_remaining()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH u AS (
    SELECT affiliation, coalesce(clubs, '{}'::text[]) AS clubs
    FROM public.users
    WHERE id = auth.uid() AND role = 'student'
  ), config AS (
    SELECT max_tickets_per_other_performance_user
    FROM public.configs
    ORDER BY id
    LIMIT 1
  ), other_classes AS (
    SELECT id
    FROM public.class_performances, u
    WHERE class_name <> concat(
      floor(u.affiliation / 10000), '-', floor((u.affiliation % 10000) / 100)
    )
  ), other_gyms AS (
    SELECT id
    FROM public.gym_performances, u
    WHERE NOT (group_name = ANY(u.clubs))
  ), used AS (
    SELECT
      (
        SELECT count(*)
        FROM public.tickets t
        JOIN public.class_tickets ct ON ct.id = t.id
        JOIN public.ticket_types tt ON tt.id = t.ticket_type
        WHERE t.user_id = auth.uid()
          AND t.status = 'valid'
          AND ct.class_id IN (SELECT id FROM other_classes)
          AND tt.name <> 'クラス公演(リハーサル)'
      ) + (
        SELECT count(*)
        FROM public.tickets t
        JOIN public.gym_tickets gt ON gt.id = t.id
        WHERE t.user_id = auth.uid()
          AND t.status = 'valid'
          AND gt.performance_id IN (SELECT id FROM other_gyms)
      ) AS value
  )
  SELECT greatest(
    config.max_tickets_per_other_performance_user - used.value, 0
  )::integer
  FROM config CROSS JOIN used;
$$;
