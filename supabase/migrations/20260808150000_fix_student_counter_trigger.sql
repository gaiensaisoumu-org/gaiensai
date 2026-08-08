CREATE OR REPLACE FUNCTION public.refresh_student_ticket_issue_counter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE owner_id uuid;
DECLARE target_id smallint;
BEGIN
  SELECT user_id INTO owner_id FROM public.tickets WHERE id = NEW.id AND status = 'valid';
  target_id := CASE WHEN TG_ARGV[0] = 'class' THEN (to_jsonb(NEW)->>'class_id')::smallint ELSE (to_jsonb(NEW)->>'performance_id')::smallint END;
  IF owner_id IS NOT NULL AND target_id IS NOT NULL THEN
    INSERT INTO public.student_ticket_issue_counters(user_id, performance_type, performance_id, issued_count)
    VALUES (owner_id, TG_ARGV[0], target_id, 1)
    ON CONFLICT (user_id, performance_type, performance_id)
    DO UPDATE SET issued_count = public.student_ticket_issue_counters.issued_count + 1;
  END IF;
  RETURN NEW;
END $$;
