-- Keep the user dashboard's initial data load to one authenticated request.
CREATE OR REPLACE FUNCTION public.get_student_dashboard()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, auth
AS $$
  WITH dashboard_user AS (
    SELECT id, affiliation, clubs
    FROM public.users
    WHERE id = auth.uid() AND role = 'student'
  ),
  valid_tickets AS (
    SELECT id, code, signature, relationship, created_at, ticket_name
    FROM public.tickets
    WHERE user_id = auth.uid() AND status = 'valid'
  )
  SELECT jsonb_build_object(
    'profile', (SELECT to_jsonb(dashboard_user) FROM dashboard_user),
    'config', (SELECT jsonb_build_object(
      'is_active', is_active,
      'show_length', show_length,
      'max_tickets_per_user', max_tickets_per_user,
      'max_tickets_per_gym_user', max_tickets_per_gym_user
    ) FROM public.configs ORDER BY id LIMIT 1),
    'controls', (SELECT jsonb_build_object(
      'class_invite_mode', class_invite_mode,
      'rehearsal_invite_mode', rehearsal_invite_mode,
      'gym_invite_mode', gym_invite_mode,
      'entry_only_mode', entry_only_mode
    ) FROM public.ticket_issue_controls WHERE id = 1),
    'class_ticket_count', (SELECT count(*) FROM public.class_tickets ct JOIN valid_tickets t ON t.id = ct.id),
    'gym_ticket_count', (SELECT count(*) FROM public.gym_tickets gt JOIN valid_tickets t ON t.id = gt.id),
    'tickets', coalesce((SELECT jsonb_agg(to_jsonb(valid_tickets) ORDER BY created_at DESC) FROM valid_tickets), '[]'::jsonb),
    'class_performances', coalesce((SELECT jsonb_agg(jsonb_build_object('id', cp.id, 'class_name', cp.class_name, 'title', cp.title)) FROM public.class_performances cp JOIN public.class_tickets ct ON ct.class_id = cp.id JOIN valid_tickets t ON t.id = ct.id), '[]'::jsonb),
    'gym_performances', coalesce((SELECT jsonb_agg(jsonb_build_object('id', gp.id, 'group_name', gp.group_name, 'round_name', gp.round_name, 'start_at', gp.start_at, 'end_at', gp.end_at)) FROM public.gym_performances gp JOIN public.gym_tickets gt ON gt.performance_id = gp.id JOIN valid_tickets t ON t.id = gt.id), '[]'::jsonb),
    'schedules', coalesce((SELECT jsonb_agg(jsonb_build_object('id', ps.id, 'start_at', ps.start_at)) FROM public.performances_schedule ps JOIN public.class_tickets ct ON ct.round_id = ps.id JOIN valid_tickets t ON t.id = ct.id), '[]'::jsonb)
  )
  WHERE EXISTS (SELECT 1 FROM dashboard_user);
$$;

CREATE OR REPLACE FUNCTION public.get_junior_my_page()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, auth
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

REVOKE ALL ON FUNCTION public.get_student_dashboard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_junior_my_page() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_junior_my_page() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_performance_availability()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, auth
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

REVOKE ALL ON FUNCTION public.get_performance_availability() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_performance_availability() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_student_issue_bootstrap()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, auth
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

REVOKE ALL ON FUNCTION public.get_student_issue_bootstrap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_issue_bootstrap() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_junior_issue_bootstrap()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, auth
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

REVOKE ALL ON FUNCTION public.get_junior_issue_bootstrap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_junior_issue_bootstrap() TO authenticated;
