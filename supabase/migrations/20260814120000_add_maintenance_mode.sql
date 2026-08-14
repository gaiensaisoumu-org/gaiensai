ALTER TABLE public.configs
  ADD COLUMN IF NOT EXISTS maintenance_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maintenance_ends_at timestamp with time zone;

CREATE OR REPLACE FUNCTION public.get_junior_my_page() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  WITH dashboard_user AS (
    SELECT id, application_day FROM public.users
    WHERE id = auth.uid() AND role = 'junior'
  ), valid_tickets AS (
    SELECT id, code, signature, relationship, created_at, ticket_name, ticket_type
    FROM public.tickets
    WHERE user_id = auth.uid() AND status = 'valid'
  )
  SELECT jsonb_build_object(
    'profile', (SELECT to_jsonb(dashboard_user) FROM dashboard_user),
    'config', (SELECT jsonb_build_object('is_active', is_active, 'maintenance_mode', maintenance_mode, 'maintenance_ends_at', maintenance_ends_at, 'max_tickets_per_junior_user', max_tickets_per_junior_user) FROM public.configs ORDER BY id LIMIT 1),
    'controls', (SELECT jsonb_build_object('class_invite_mode', class_invite_mode, 'rehearsal_invite_mode', rehearsal_invite_mode, 'gym_invite_mode', gym_invite_mode, 'entry_only_mode', entry_only_mode) FROM public.ticket_issue_controls WHERE id = 1),
    'non_entry_ticket_count', (SELECT count(*) FROM valid_tickets WHERE ticket_type <> 7),
    'entry_only_ticket_count', (SELECT count(*) FROM valid_tickets WHERE ticket_type = 7),
    'tickets', coalesce((SELECT jsonb_agg(to_jsonb(valid_tickets) ORDER BY created_at DESC) FROM valid_tickets), '[]'::jsonb),
    'class_performances', coalesce((SELECT jsonb_agg(jsonb_build_object('id', cp.id, 'class_name', cp.class_name, 'title', cp.title)) FROM public.class_performances cp JOIN public.class_tickets ct ON ct.class_id = cp.id JOIN valid_tickets t ON t.id = ct.id), '[]'::jsonb),
    'gym_performances', coalesce((SELECT jsonb_agg(jsonb_build_object('id', gp.id, 'group_name', gp.group_name, 'round_name', gp.round_name)) FROM public.gym_performances gp JOIN public.gym_tickets gt ON gt.performance_id = gp.id JOIN valid_tickets t ON t.id = gt.id), '[]'::jsonb)
  )
  WHERE EXISTS (SELECT 1 FROM dashboard_user);
$$;

CREATE OR REPLACE FUNCTION public.get_student_dashboard() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  WITH dashboard_user AS (SELECT id, affiliation, clubs, account_confirmed FROM public.users WHERE id = auth.uid() AND role = 'student'),
  valid_tickets AS (SELECT id, code, signature, relationship, created_at, ticket_name FROM public.tickets WHERE user_id = auth.uid() AND status = 'valid')
  SELECT jsonb_build_object(
    'profile', (SELECT to_jsonb(dashboard_user) FROM dashboard_user),
    'config', (SELECT jsonb_build_object('is_active', is_active, 'maintenance_mode', maintenance_mode, 'maintenance_ends_at', maintenance_ends_at, 'show_length', show_length, 'max_tickets_per_other_class_user', max_tickets_per_other_class_user, 'max_tickets_per_other_performance_user', max_tickets_per_other_performance_user, 'max_tickets_per_other_club_user', max_tickets_per_other_club_user, 'gym_ticket_limits_by_club', gym_ticket_limits_by_club) FROM public.configs ORDER BY id LIMIT 1),
    'controls', (SELECT jsonb_build_object('class_invite_mode', class_invite_mode, 'rehearsal_invite_mode', rehearsal_invite_mode, 'gym_invite_mode', gym_invite_mode, 'entry_only_mode', entry_only_mode) FROM public.ticket_issue_controls WHERE id = 1),
    'class_ticket_count', (SELECT count(*) FROM public.class_tickets ct JOIN valid_tickets t ON t.id = ct.id),
    'gym_ticket_count', (SELECT count(*) FROM public.gym_tickets gt JOIN valid_tickets t ON t.id = gt.id),
    'tickets', coalesce((SELECT jsonb_agg(to_jsonb(valid_tickets) ORDER BY created_at DESC) FROM valid_tickets), '[]'::jsonb),
    'class_performances', coalesce((SELECT jsonb_agg(jsonb_build_object('id', cp.id, 'class_name', cp.class_name, 'title', cp.title)) FROM public.class_performances cp JOIN public.class_tickets ct ON ct.class_id = cp.id JOIN valid_tickets t ON t.id = ct.id), '[]'::jsonb),
    'gym_performances', coalesce((SELECT jsonb_agg(jsonb_build_object('id', gp.id, 'group_name', gp.group_name, 'round_name', gp.round_name, 'start_at', gp.start_at, 'end_at', gp.end_at)) FROM public.gym_performances gp JOIN public.gym_tickets gt ON gt.performance_id = gp.id JOIN valid_tickets t ON t.id = gt.id), '[]'::jsonb),
    'schedules', coalesce((SELECT jsonb_agg(jsonb_build_object('id', ps.id, 'start_at', ps.start_at)) FROM public.performances_schedule ps JOIN public.class_tickets ct ON ct.round_id = ps.id JOIN valid_tickets t ON t.id = ct.id), '[]'::jsonb)
  ) WHERE EXISTS (SELECT 1 FROM dashboard_user);
$$;
