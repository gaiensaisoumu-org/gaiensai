CREATE OR REPLACE FUNCTION public.sync_student_ticket_issue_counter_on_ticket_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE
  owner_id uuid;
  target_id smallint;
  counter_type text;
  delta integer;
BEGIN
  owner_id := coalesce(NEW.user_id, OLD.user_id);
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.status = 'valid' AND NEW.status <> 'valid') THEN
    delta := -1;
  ELSIF TG_OP = 'UPDATE' AND OLD.status <> 'valid' AND NEW.status = 'valid' THEN
    delta := 1;
  ELSE
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT 'class', class_id INTO counter_type, target_id FROM public.class_tickets WHERE id = coalesce(NEW.id, OLD.id);
  IF counter_type IS NULL THEN
    SELECT 'gym', performance_id INTO counter_type, target_id FROM public.gym_tickets WHERE id = coalesce(NEW.id, OLD.id);
  END IF;

  IF owner_id IS NOT NULL AND counter_type IS NOT NULL THEN
    INSERT INTO public.student_ticket_issue_counters(user_id, performance_type, performance_id, issued_count)
    VALUES (owner_id, counter_type, target_id, greatest(delta, 0))
    ON CONFLICT (user_id, performance_type, performance_id)
    DO UPDATE SET issued_count = greatest(public.student_ticket_issue_counters.issued_count + delta, 0);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

DROP TRIGGER IF EXISTS sync_student_ticket_counter_on_ticket_change ON public.tickets;
CREATE TRIGGER sync_student_ticket_counter_on_ticket_change
AFTER UPDATE OF status OR DELETE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.sync_student_ticket_issue_counter_on_ticket_change();
