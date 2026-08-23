-- 体育館公演の生徒別上限は公演回単位ではなく部活単位で適用される。
-- 兼部時にも画面表示と発券APIを一致させるため、同一部活の各公演回へ
-- 同じ残数を返す。
CREATE OR REPLACE FUNCTION public.get_student_performance_ticket_remaining()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public, auth
AS $$
  WITH current_user_data AS (
    SELECT affiliation, coalesce(clubs, '{}'::text[]) AS clubs
    FROM public.users
    WHERE id = auth.uid() AND role = 'student'
  ), config AS (
    SELECT
      max_tickets_per_other_class_user,
      max_tickets_per_other_club_user,
      gym_ticket_limits_by_club
    FROM public.configs
    ORDER BY id
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'class', coalesce((
      SELECT jsonb_object_agg(
        cp.id::text,
        greatest(
          CASE
            WHEN cp.class_name = concat(
              floor(u.affiliation / 10000),
              '-',
              floor((u.affiliation % 10000) / 100)
            ) THEN cp.max_tickets_per_user
            ELSE cfg.max_tickets_per_other_class_user
          END - coalesce(counter.issued_count, 0),
          0
        )
      )
      FROM public.class_performances cp
      CROSS JOIN current_user_data u
      CROSS JOIN config cfg
      LEFT JOIN public.student_ticket_issue_counters counter
        ON counter.performance_id = cp.id
        AND counter.performance_type = 'class'
        AND counter.user_id = auth.uid()
    ), '{}'::jsonb),
    'gym', coalesce((
      SELECT jsonb_object_agg(
        gp.id::text,
        greatest(
          CASE
            WHEN gp.group_name = ANY(u.clubs)
              THEN coalesce(
                (cfg.gym_ticket_limits_by_club ->> gp.group_name)::integer,
                cfg.max_tickets_per_other_club_user
              )
            ELSE cfg.max_tickets_per_other_club_user
          END - coalesce((
            SELECT count(*)
            FROM public.tickets t
            JOIN public.gym_tickets gt ON gt.id = t.id
            JOIN public.gym_performances group_performance
              ON group_performance.id = gt.performance_id
            WHERE t.user_id = auth.uid()
              AND t.status = 'valid'
              AND group_performance.group_name = gp.group_name
          ), 0),
          0
        )
      )
      FROM public.gym_performances gp
      CROSS JOIN current_user_data u
      CROSS JOIN config cfg
    ), '{}'::jsonb),
    'class_names', coalesce(
      (SELECT jsonb_object_agg(id::text, class_name) FROM public.class_performances),
      '{}'::jsonb
    ),
    'gym_names', coalesce(
      (SELECT jsonb_object_agg(id::text, group_name) FROM public.gym_performances),
      '{}'::jsonb
    ),
    'other_total_remaining', public.get_student_other_performance_total_remaining()
  );
$$;
