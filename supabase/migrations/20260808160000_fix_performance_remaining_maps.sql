CREATE OR REPLACE FUNCTION public.get_student_performance_ticket_remaining()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, auth AS $$
  SELECT jsonb_build_object(
    'class', coalesce((SELECT jsonb_object_agg(cp.id::text, greatest(CASE WHEN cp.class_name = concat(floor(u.affiliation / 10000), '-', floor((u.affiliation % 10000) / 100)) THEN cp.max_tickets_per_user ELSE cfg.max_tickets_per_other_class_user END - coalesce(c.issued_count, 0), 0)) FROM public.class_performances cp CROSS JOIN public.configs cfg CROSS JOIN public.users u LEFT JOIN public.student_ticket_issue_counters c ON c.performance_id = cp.id AND c.performance_type = 'class' AND c.user_id = auth.uid() WHERE u.id = auth.uid()), '{}'::jsonb),
    'gym', coalesce((SELECT jsonb_object_agg(gp.id::text, greatest(CASE WHEN gp.group_name = ANY(coalesce(u.clubs, '{}'::text[])) THEN coalesce((cfg.gym_ticket_limits_by_club ->> gp.group_name)::integer, cfg.max_tickets_per_other_club_user) ELSE cfg.max_tickets_per_other_club_user END - coalesce(c.issued_count, 0), 0)) FROM public.gym_performances gp CROSS JOIN public.configs cfg CROSS JOIN public.users u LEFT JOIN public.student_ticket_issue_counters c ON c.performance_id = gp.id AND c.performance_type = 'gym' AND c.user_id = auth.uid() WHERE u.id = auth.uid()), '{}'::jsonb),
    'class_names', coalesce((SELECT jsonb_object_agg(id::text, class_name) FROM public.class_performances), '{}'::jsonb),
    'gym_names', coalesce((SELECT jsonb_object_agg(id::text, group_name) FROM public.gym_performances), '{}'::jsonb),
    'other_total_remaining', public.get_student_other_performance_total_remaining()
  );
$$;
