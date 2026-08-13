-- user_id はチケット利用者、issued_by_user_id は発行枠を負担した利用者。
ALTER TABLE public.tickets
  ADD COLUMN issued_by_user_id uuid;

UPDATE public.tickets
SET issued_by_user_id = user_id
WHERE issued_by_user_id IS NULL;

ALTER TABLE public.tickets
  ALTER COLUMN issued_by_user_id SET NOT NULL,
  ADD CONSTRAINT tickets_issued_by_user_id_fkey
    FOREIGN KEY (issued_by_user_id) REFERENCES public.users(id);

CREATE OR REPLACE FUNCTION public.set_ticket_issued_by_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.issued_by_user_id IS NULL THEN
    NEW.issued_by_user_id := NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_ticket_issued_by_user_id
BEFORE INSERT ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.set_ticket_issued_by_user_id();

CREATE OR REPLACE FUNCTION public.refresh_student_ticket_issue_counter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  issuer_id uuid;
  target_id smallint;
BEGIN
  SELECT issued_by_user_id INTO issuer_id
  FROM public.tickets
  WHERE id = NEW.id AND status = 'valid';

  target_id := CASE
    WHEN TG_ARGV[0] = 'class' THEN (to_jsonb(NEW)->>'class_id')::smallint
    ELSE (to_jsonb(NEW)->>'performance_id')::smallint
  END;

  IF issuer_id IS NOT NULL AND target_id IS NOT NULL THEN
    INSERT INTO public.student_ticket_issue_counters(
      user_id, performance_type, performance_id, issued_count
    ) VALUES (issuer_id, TG_ARGV[0], target_id, 1)
    ON CONFLICT (user_id, performance_type, performance_id)
    DO UPDATE SET issued_count = public.student_ticket_issue_counters.issued_count + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_student_ticket_issue_counter_on_ticket_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_id smallint;
  counter_type text;
  old_issuer_id uuid;
  new_issuer_id uuid;
BEGIN
  SELECT 'class', class_id INTO counter_type, target_id
  FROM public.class_tickets
  WHERE id = coalesce(NEW.id, OLD.id);
  IF counter_type IS NULL THEN
    SELECT 'gym', performance_id INTO counter_type, target_id
    FROM public.gym_tickets
    WHERE id = coalesce(NEW.id, OLD.id);
  END IF;
  IF counter_type IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  old_issuer_id := OLD.issued_by_user_id;
  new_issuer_id := NEW.issued_by_user_id;

  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.status = 'valid' AND NEW.status <> 'valid') THEN
    INSERT INTO public.student_ticket_issue_counters(user_id, performance_type, performance_id, issued_count)
    VALUES (old_issuer_id, counter_type, target_id, 0)
    ON CONFLICT (user_id, performance_type, performance_id)
    DO UPDATE SET issued_count = greatest(public.student_ticket_issue_counters.issued_count - 1, 0);
  ELSIF TG_OP = 'UPDATE' AND OLD.status <> 'valid' AND NEW.status = 'valid' THEN
    INSERT INTO public.student_ticket_issue_counters(user_id, performance_type, performance_id, issued_count)
    VALUES (new_issuer_id, counter_type, target_id, 1)
    ON CONFLICT (user_id, performance_type, performance_id)
    DO UPDATE SET issued_count = public.student_ticket_issue_counters.issued_count + 1;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'valid' AND NEW.status = 'valid'
    AND OLD.issued_by_user_id IS DISTINCT FROM NEW.issued_by_user_id THEN
    INSERT INTO public.student_ticket_issue_counters(user_id, performance_type, performance_id, issued_count)
    VALUES (old_issuer_id, counter_type, target_id, 0)
    ON CONFLICT (user_id, performance_type, performance_id)
    DO UPDATE SET issued_count = greatest(public.student_ticket_issue_counters.issued_count - 1, 0);

    INSERT INTO public.student_ticket_issue_counters(user_id, performance_type, performance_id, issued_count)
    VALUES (new_issuer_id, counter_type, target_id, 1)
    ON CONFLICT (user_id, performance_type, performance_id)
    DO UPDATE SET issued_count = public.student_ticket_issue_counters.issued_count + 1;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER sync_student_ticket_counter_on_ticket_change ON public.tickets;
CREATE TRIGGER sync_student_ticket_counter_on_ticket_change
AFTER DELETE OR UPDATE OF status, issued_by_user_id ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.sync_student_ticket_issue_counter_on_ticket_change();

-- 既存コードから採番カウンターを安全に前進させるための補正用RPC。
CREATE OR REPLACE FUNCTION public.advance_ticket_code_counter_to_at_least(
  p_prefix text,
  p_last_value bigint
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_last_value bigint;
BEGIN
  IF p_prefix IS NULL OR length(trim(p_prefix)) = 0 THEN
    RAISE EXCEPTION 'prefix is required';
  END IF;
  IF p_last_value IS NULL OR p_last_value < 0 THEN
    RAISE EXCEPTION 'last_value must be non-negative';
  END IF;

  INSERT INTO public.ticket_code_counters(prefix, last_value)
  VALUES (p_prefix, p_last_value)
  ON CONFLICT (prefix) DO UPDATE
    SET last_value = greatest(public.ticket_code_counters.last_value, excluded.last_value),
        updated_at = now()
  RETURNING last_value INTO v_last_value;

  RETURN v_last_value;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_ticket_code_counter_to_at_least(text, bigint)
TO service_role;

CREATE OR REPLACE FUNCTION public.reissue_ticket_change_relationship_with_codes(
  p_user_id uuid,
  p_old_code text,
  p_ticket_type_id smallint,
  p_performance_id smallint,
  p_schedule_id smallint,
  p_new_relationship_id smallint,
  p_issue_count smallint,
  p_codes text[],
  p_signatures text[],
  p_person_count smallint DEFAULT 1
) RETURNS TABLE(code text, signature text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ticket_id uuid;
  v_status public.ticket_status;
  v_ticket_type smallint;
  v_class_id smallint;
  v_round_id smallint;
  v_issued_by_user_id uuid;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user is required'; END IF;
  IF p_old_code IS NULL OR length(trim(p_old_code)) = 0 THEN RAISE EXCEPTION 'old_code is required'; END IF;
  IF p_issue_count IS NULL OR p_issue_count <> 1 THEN RAISE EXCEPTION 'issue_count must be 1'; END IF;
  IF p_codes IS NULL OR p_signatures IS NULL THEN RAISE EXCEPTION 'codes/signatures are required'; END IF;
  IF array_length(p_codes, 1) IS DISTINCT FROM p_issue_count OR array_length(p_signatures, 1) IS DISTINCT FROM p_issue_count THEN RAISE EXCEPTION 'codes/signatures length mismatch'; END IF;
  IF p_new_relationship_id IS NULL OR p_new_relationship_id <= 0 THEN RAISE EXCEPTION 'new_relationship_id must be positive'; END IF;

  SELECT t.id, t.status, t.ticket_type, t.issued_by_user_id
  INTO v_ticket_id, v_status, v_ticket_type, v_issued_by_user_id
  FROM public.tickets t WHERE t.code = p_old_code LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  IF v_status IS DISTINCT FROM 'valid' THEN RAISE EXCEPTION 'only valid tickets can be reissued'; END IF;
  IF v_ticket_type IS DISTINCT FROM p_ticket_type_id THEN RAISE EXCEPTION 'ticket_type mismatch'; END IF;

  IF p_ticket_type_id = 4 OR p_ticket_type_id = 7 THEN
    IF p_performance_id <> 0 OR p_schedule_id <> 0 THEN RAISE EXCEPTION 'admission-only ticket requires performanceId=0 and scheduleId=0'; END IF;
  ELSE
    SELECT class_id, round_id INTO v_class_id, v_round_id
    FROM public.class_tickets WHERE id = v_ticket_id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'class ticket mapping not found'; END IF;
    IF v_class_id IS DISTINCT FROM p_performance_id OR v_round_id IS DISTINCT FROM p_schedule_id THEN RAISE EXCEPTION 'performance/schedule mismatch'; END IF;
  END IF;

  UPDATE public.tickets SET status = 'cancelled', updated_at = now() WHERE id = v_ticket_id;
  RETURN QUERY SELECT it.code, it.signature FROM public.issue_class_tickets_with_codes(
    p_user_id, p_ticket_type_id, p_new_relationship_id, p_performance_id,
    p_schedule_id, p_issue_count, p_codes, p_signatures, p_person_count
  ) AS it;
  UPDATE public.tickets AS t SET issued_by_user_id = v_issued_by_user_id
  WHERE t.code = p_codes[1] AND t.user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reissue_gym_ticket_change_relationship_with_codes(
  p_user_id uuid,
  p_old_code text,
  p_ticket_type_id smallint,
  p_performance_id smallint,
  p_schedule_id smallint,
  p_new_relationship_id smallint,
  p_issue_count smallint,
  p_codes text[],
  p_signatures text[],
  p_person_count smallint DEFAULT 1
) RETURNS TABLE(code text, signature text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ticket_id uuid;
  v_status public.ticket_status;
  v_ticket_type smallint;
  v_performance_id smallint;
  v_issued_by_user_id uuid;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user is required'; END IF;
  IF p_old_code IS NULL OR length(trim(p_old_code)) = 0 THEN RAISE EXCEPTION 'old_code is required'; END IF;
  IF p_issue_count IS NULL OR p_issue_count <> 1 THEN RAISE EXCEPTION 'issue_count must be 1'; END IF;
  IF p_codes IS NULL OR p_signatures IS NULL THEN RAISE EXCEPTION 'codes/signatures are required'; END IF;
  IF array_length(p_codes, 1) IS DISTINCT FROM p_issue_count OR array_length(p_signatures, 1) IS DISTINCT FROM p_issue_count THEN RAISE EXCEPTION 'codes/signatures length mismatch'; END IF;
  IF p_new_relationship_id IS NULL OR p_new_relationship_id <= 0 THEN RAISE EXCEPTION 'new_relationship_id must be positive'; END IF;
  IF p_performance_id <= 0 OR p_schedule_id <> 0 THEN RAISE EXCEPTION 'gym ticket reissue requires performance_id > 0 and schedule_id = 0'; END IF;

  SELECT t.id, t.status, t.ticket_type, t.issued_by_user_id
  INTO v_ticket_id, v_status, v_ticket_type, v_issued_by_user_id
  FROM public.tickets t WHERE t.code = p_old_code LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  IF v_status IS DISTINCT FROM 'valid' THEN RAISE EXCEPTION 'only valid tickets can be reissued'; END IF;
  IF v_ticket_type IS DISTINCT FROM p_ticket_type_id THEN RAISE EXCEPTION 'ticket_type mismatch'; END IF;

  SELECT performance_id INTO v_performance_id FROM public.gym_tickets
  WHERE id = v_ticket_id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'gym ticket mapping not found'; END IF;
  IF v_performance_id IS DISTINCT FROM p_performance_id THEN RAISE EXCEPTION 'performance mismatch'; END IF;

  UPDATE public.tickets SET status = 'cancelled', updated_at = now() WHERE id = v_ticket_id;
  RETURN QUERY SELECT it.code, it.signature FROM public.issue_gym_tickets_with_codes(
    p_user_id, p_ticket_type_id, p_new_relationship_id, p_performance_id,
    p_schedule_id, p_issue_count, p_codes, p_signatures, p_person_count
  ) AS it;
  UPDATE public.tickets AS t SET issued_by_user_id = v_issued_by_user_id
  WHERE t.code = p_codes[1] AND t.user_id = p_user_id;
END;
$$;
