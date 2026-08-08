CREATE TABLE IF NOT EXISTS public.student_ticket_issue_counters (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  performance_type text NOT NULL CHECK (performance_type IN ('class', 'gym')),
  performance_id smallint NOT NULL,
  issued_count integer NOT NULL DEFAULT 0 CHECK (issued_count >= 0),
  PRIMARY KEY (user_id, performance_type, performance_id)
);

CREATE INDEX IF NOT EXISTS student_ticket_issue_counters_lookup_idx
  ON public.student_ticket_issue_counters (user_id, performance_type);

CREATE OR REPLACE FUNCTION public.refresh_student_ticket_issue_counter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id FROM public.tickets WHERE id = NEW.id AND status = 'valid';
  IF owner_id IS NOT NULL THEN
    INSERT INTO public.student_ticket_issue_counters(user_id, performance_type, performance_id, issued_count)
    VALUES (owner_id, TG_ARGV[0], CASE WHEN TG_ARGV[0] = 'class' THEN (to_jsonb(NEW)->>'class_id')::smallint ELSE (to_jsonb(NEW)->>'performance_id')::smallint END, 1)
    ON CONFLICT (user_id, performance_type, performance_id)
    DO UPDATE SET issued_count = public.student_ticket_issue_counters.issued_count + 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS refresh_student_class_ticket_issue_counter ON public.class_tickets;
CREATE TRIGGER refresh_student_class_ticket_issue_counter AFTER INSERT ON public.class_tickets
FOR EACH ROW EXECUTE FUNCTION public.refresh_student_ticket_issue_counter('class');
DROP TRIGGER IF EXISTS refresh_student_gym_ticket_issue_counter ON public.gym_tickets;
CREATE TRIGGER refresh_student_gym_ticket_issue_counter AFTER INSERT ON public.gym_tickets
FOR EACH ROW EXECUTE FUNCTION public.refresh_student_ticket_issue_counter('gym');

INSERT INTO public.student_ticket_issue_counters (user_id, performance_type, performance_id, issued_count)
SELECT t.user_id, 'class', ct.class_id, count(*)::integer
FROM public.tickets t JOIN public.class_tickets ct ON ct.id = t.id
WHERE t.status = 'valid' AND t.user_id IS NOT NULL
GROUP BY t.user_id, ct.class_id
ON CONFLICT (user_id, performance_type, performance_id) DO UPDATE SET issued_count = EXCLUDED.issued_count;

INSERT INTO public.student_ticket_issue_counters (user_id, performance_type, performance_id, issued_count)
SELECT t.user_id, 'gym', gt.performance_id, count(*)::integer
FROM public.tickets t JOIN public.gym_tickets gt ON gt.id = t.id
WHERE t.status = 'valid' AND t.user_id IS NOT NULL
GROUP BY t.user_id, gt.performance_id
ON CONFLICT (user_id, performance_type, performance_id) DO UPDATE SET issued_count = EXCLUDED.issued_count;

ALTER TABLE public.student_ticket_issue_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY student_ticket_issue_counters_self_read ON public.student_ticket_issue_counters
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.get_student_performance_ticket_remaining()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, auth AS $$
  SELECT jsonb_build_object(
    'class', coalesce((SELECT jsonb_object_agg(performance_id::text, greatest(cp.max_tickets_per_user - c.issued_count, 0)) FROM public.student_ticket_issue_counters c JOIN public.class_performances cp ON cp.id = c.performance_id WHERE c.user_id = auth.uid() AND c.performance_type = 'class'), '{}'::jsonb),
    'gym', coalesce((SELECT jsonb_object_agg(performance_id::text, greatest(CASE WHEN gp.group_name = ANY(coalesce(u.clubs, '{}'::text[])) THEN coalesce((cfg.gym_ticket_limits_by_club ->> gp.group_name)::integer, cfg.max_tickets_per_other_club_user) ELSE cfg.max_tickets_per_other_club_user END - c.issued_count, 0)) FROM public.student_ticket_issue_counters c JOIN public.gym_performances gp ON gp.id = c.performance_id CROSS JOIN public.configs cfg CROSS JOIN public.users u WHERE c.user_id = auth.uid() AND u.id = auth.uid() AND c.performance_type = 'gym'), '{}'::jsonb),
    'class_names', coalesce((SELECT jsonb_object_agg(id::text, class_name) FROM public.class_performances), '{}'::jsonb),
    'gym_names', coalesce((SELECT jsonb_object_agg(id::text, group_name) FROM public.gym_performances), '{}'::jsonb),
    'other_total_remaining', public.get_student_other_performance_total_remaining()
  );
$$;

REVOKE ALL ON FUNCTION public.get_student_performance_ticket_remaining() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_performance_ticket_remaining() TO authenticated;
