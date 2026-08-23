-- Only tickets whose type is the rehearsal type may affect a rehearsal's
-- counter.  A normal schedule and a rehearsal can share a round_id.
CREATE OR REPLACE FUNCTION public.sync_rehearsal_active_ticket_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_class_id smallint;
  v_round_id smallint;
  v_delta integer := 0;
  v_ticket_type smallint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_ticket_type := OLD.ticket_type;
    v_delta := CASE WHEN OLD.status = 'valid' THEN -1 ELSE 0 END;
    SELECT class_id, round_id INTO v_class_id, v_round_id
    FROM public.class_tickets WHERE id = OLD.id;
  ELSE
    v_ticket_type := NEW.ticket_type;
    IF OLD.status = NEW.status THEN RETURN NEW; END IF;
    v_delta := CASE
      WHEN NEW.status = 'valid' THEN 1
      WHEN OLD.status = 'valid' THEN -1
      ELSE 0
    END;
    SELECT class_id, round_id INTO v_class_id, v_round_id
    FROM public.class_tickets WHERE id = NEW.id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ticket_types
    WHERE id = v_ticket_type AND name = 'クラス公演(リハーサル)'
  ) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF v_delta <> 0 AND v_class_id IS NOT NULL THEN
    UPDATE public.rehearsals
    SET active_ticket_count = greatest(active_ticket_count + v_delta, 0)
    WHERE class_id = v_class_id AND round_id = v_round_id
      AND type = 'unofficial';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.count_new_rehearsal_ticket()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tickets t
    JOIN public.ticket_types tt ON tt.id = t.ticket_type
    WHERE t.id = NEW.id AND t.status = 'valid'
      AND tt.name = 'クラス公演(リハーサル)'
  ) THEN
    UPDATE public.rehearsals
    SET active_ticket_count = active_ticket_count + 1
    WHERE class_id = NEW.class_id AND round_id = NEW.round_id
      AND type = 'unofficial';
  END IF;
  RETURN NEW;
END $$;

-- Repair rows that may have previously counted normal class tickets with the
-- same class_id/round_id as a rehearsal.
UPDATE public.rehearsals r
SET active_ticket_count = (
  SELECT count(*)
  FROM public.class_tickets ct
  JOIN public.tickets t ON t.id = ct.id
  JOIN public.ticket_types tt ON tt.id = t.ticket_type
  WHERE ct.class_id = r.class_id
    AND ct.round_id = r.round_id
    AND t.status = 'valid'
    AND tt.name = 'クラス公演(リハーサル)'
)
WHERE r.type = 'unofficial';
