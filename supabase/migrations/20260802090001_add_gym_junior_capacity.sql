-- 体育館公演でも、一般枠と中学生枠を分けて管理する。

ALTER TABLE public.gym_performances
  ADD COLUMN IF NOT EXISTS junior_capacity smallint NOT NULL DEFAULT 50;

ALTER TABLE public.gym_performances
  DROP CONSTRAINT IF EXISTS gym_performances_junior_capacity_check;

ALTER TABLE public.gym_performances
  ADD CONSTRAINT gym_performances_junior_capacity_check
  CHECK (junior_capacity >= 0 AND junior_capacity <= capacity);

ALTER TABLE public.gym_ticket_counters
  ADD COLUMN IF NOT EXISTS issued_general integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS issued_junior integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS issued_other integer NOT NULL DEFAULT 0;

ALTER TABLE public.gym_ticket_counters
  DROP CONSTRAINT IF EXISTS gym_ticket_counters_issued_general_check,
  DROP CONSTRAINT IF EXISTS gym_ticket_counters_issued_junior_check,
  DROP CONSTRAINT IF EXISTS gym_ticket_counters_issued_other_check;

ALTER TABLE public.gym_ticket_counters
  ADD CONSTRAINT gym_ticket_counters_issued_general_check CHECK (issued_general >= 0),
  ADD CONSTRAINT gym_ticket_counters_issued_junior_check CHECK (issued_junior >= 0),
  ADD CONSTRAINT gym_ticket_counters_issued_other_check CHECK (issued_other >= 0);

-- 既存の発券済みチケットも券種別に再集計する。
UPDATE public.gym_ticket_counters gtc
SET
  issued_general = counts.issued_general,
  issued_junior = counts.issued_junior,
  issued_other = counts.issued_other,
  issued_count = counts.issued_general + counts.issued_junior + counts.issued_other,
  updated_at = now()
FROM (
  SELECT
    gt.performance_id,
    coalesce(sum(t.person_count) FILTER (
      WHERE t.status = 'valid' AND t.ticket_type IN (3, 9)
    ), 0)::integer AS issued_general,
    coalesce(sum(t.person_count) FILTER (
      WHERE t.status = 'valid' AND t.ticket_type = 6
    ), 0)::integer AS issued_junior,
    coalesce(sum(t.person_count) FILTER (
      WHERE t.status = 'valid' AND t.ticket_type NOT IN (3, 6, 9)
    ), 0)::integer AS issued_other
  FROM public.gym_tickets gt
  JOIN public.tickets t ON t.id = gt.id
  GROUP BY gt.performance_id
) counts
WHERE gtc.performance_id = counts.performance_id;

CREATE OR REPLACE FUNCTION public.adjust_gym_ticket_counter_for_ticket_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_performance_id smallint;
  old_general integer := 0;
  old_junior integer := 0;
  old_other integer := 0;
  new_general integer := 0;
  new_junior integer := 0;
  new_other integer := 0;
BEGIN
  SELECT gt.performance_id INTO v_performance_id
  FROM public.gym_tickets gt
  WHERE gt.id = NEW.id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'valid' THEN
    IF OLD.ticket_type IN (3, 9) THEN old_general := OLD.person_count;
    ELSIF OLD.ticket_type = 6 THEN old_junior := OLD.person_count;
    ELSE old_other := OLD.person_count;
    END IF;
  END IF;

  IF NEW.status = 'valid' THEN
    IF NEW.ticket_type IN (3, 9) THEN new_general := NEW.person_count;
    ELSIF NEW.ticket_type = 6 THEN new_junior := NEW.person_count;
    ELSE new_other := NEW.person_count;
    END IF;
  END IF;

  IF old_general = new_general AND old_junior = new_junior AND old_other = new_other THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.gym_ticket_counters (
    performance_id, issued_count, issued_general, issued_junior, issued_other
  ) VALUES (
    v_performance_id,
    greatest(new_general + new_junior + new_other - old_general - old_junior - old_other, 0),
    greatest(new_general - old_general, 0),
    greatest(new_junior - old_junior, 0),
    greatest(new_other - old_other, 0)
  ) ON CONFLICT (performance_id) DO UPDATE SET
    issued_count = greatest(public.gym_ticket_counters.issued_count + new_general + new_junior + new_other - old_general - old_junior - old_other, 0),
    issued_general = greatest(public.gym_ticket_counters.issued_general + new_general - old_general, 0),
    issued_junior = greatest(public.gym_ticket_counters.issued_junior + new_junior - old_junior, 0),
    issued_other = greatest(public.gym_ticket_counters.issued_other + new_other - old_other, 0),
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_gym_ticket_counter_for_mapping_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_general integer := 0;
  v_junior integer := 0;
  v_other integer := 0;
BEGIN
  SELECT * INTO v_ticket FROM public.tickets WHERE id = OLD.id LIMIT 1;
  IF NOT FOUND OR v_ticket.status IS DISTINCT FROM 'valid' THEN RETURN OLD; END IF;

  IF v_ticket.ticket_type IN (3, 9) THEN v_general := v_ticket.person_count;
  ELSIF v_ticket.ticket_type = 6 THEN v_junior := v_ticket.person_count;
  ELSE v_other := v_ticket.person_count;
  END IF;

  UPDATE public.gym_ticket_counters SET
    issued_count = greatest(issued_count - v_general - v_junior - v_other, 0),
    issued_general = greatest(issued_general - v_general, 0),
    issued_junior = greatest(issued_junior - v_junior, 0),
    issued_other = greatest(issued_other - v_other, 0),
    updated_at = now()
  WHERE performance_id = OLD.performance_id;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_gym_tickets_with_codes(p_user_id uuid, p_ticket_type_id smallint, p_relationship_id smallint, p_performance_id smallint, p_schedule_id smallint, p_issue_count smallint, p_codes text[], p_signatures text[], p_person_count smallint DEFAULT 1)
RETURNS TABLE(code text, signature text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  i integer; v_ticket_id uuid; v_capacity integer; v_junior_capacity integer;
  v_is_released boolean; v_issued_general integer; v_issued_junior integer;
  v_issued_other integer; v_need integer; v_general_remaining_raw integer;
  v_general_remaining integer; v_junior_remaining integer;
BEGIN
  IF p_issue_count IS NULL OR p_issue_count <= 0 THEN RAISE EXCEPTION 'issue_count must be positive'; END IF;
  IF array_length(p_codes, 1) IS DISTINCT FROM p_issue_count OR array_length(p_signatures, 1) IS DISTINCT FROM p_issue_count THEN RAISE EXCEPTION 'codes/signatures length mismatch'; END IF;
  v_need := p_issue_count * p_person_count;

  INSERT INTO public.gym_ticket_counters (performance_id) VALUES (p_performance_id) ON CONFLICT (performance_id) DO NOTHING;
  SELECT gp.capacity, gp.junior_capacity, coalesce(cfg.junior_release_open, false),
    gtc.issued_general, gtc.issued_junior, gtc.issued_other
  INTO v_capacity, v_junior_capacity, v_is_released, v_issued_general, v_issued_junior, v_issued_other
  FROM public.gym_ticket_counters gtc
  JOIN public.gym_performances gp ON gp.id = gtc.performance_id
  CROSS JOIN LATERAL (SELECT junior_release_open FROM public.configs ORDER BY id LIMIT 1) cfg
  WHERE gtc.performance_id = p_performance_id FOR UPDATE OF gtc;
  IF NOT FOUND THEN RAISE EXCEPTION 'gym ticket counter was not initialized'; END IF;

  IF v_is_released THEN
    v_general_remaining := greatest(v_capacity - v_issued_general - v_issued_junior - v_issued_other, 0);
    v_junior_remaining := v_general_remaining;
  ELSE
    v_general_remaining_raw := v_capacity - v_junior_capacity - v_issued_general - v_issued_other;
    v_general_remaining := greatest(v_general_remaining_raw, 0);
    v_junior_remaining := greatest(v_junior_capacity - v_issued_junior - greatest(-v_general_remaining_raw, 0), 0);
  END IF;

  IF p_ticket_type_id = 6 THEN
    IF v_junior_remaining < v_need THEN RAISE EXCEPTION '中学生用の予約枠が上限に達しました。'; END IF;
  ELSIF p_ticket_type_id IN (3, 9) THEN
    IF v_general_remaining < v_need THEN RAISE EXCEPTION '招待券用の残席がありません。'; END IF;
  ELSIF v_general_remaining + v_junior_remaining < v_need THEN
    RAISE EXCEPTION '体育館公演の定員を超過しています。';
  END IF;

  UPDATE public.gym_ticket_counters SET
    issued_count = issued_count + v_need,
    issued_general = issued_general + CASE WHEN p_ticket_type_id IN (3, 9) THEN v_need ELSE 0 END,
    issued_junior = issued_junior + CASE WHEN p_ticket_type_id = 6 THEN v_need ELSE 0 END,
    issued_other = issued_other + CASE WHEN p_ticket_type_id NOT IN (3, 6, 9) THEN v_need ELSE 0 END,
    updated_at = now()
  WHERE performance_id = p_performance_id;

  FOR i IN 1..p_issue_count LOOP
    INSERT INTO public.tickets (user_id, ticket_type, relationship, status, code, signature, person_count)
    VALUES (p_user_id, p_ticket_type_id, p_relationship_id, 'valid', p_codes[i], p_signatures[i], p_person_count)
    RETURNING id INTO v_ticket_id;
    INSERT INTO public.gym_tickets (id, performance_id) VALUES (v_ticket_id, p_performance_id);
  END LOOP;
  RETURN QUERY SELECT unnest(p_codes), unnest(p_signatures);
END;
$$;
