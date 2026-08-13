-- RETURNS TABLE の code 出力変数と tickets.code の名前衝突を避けるため、
-- 既に適用済みの関数をテーブル別名つきのSQLへ置き換える。
CREATE OR REPLACE FUNCTION public.reissue_ticket_change_relationship_with_codes(
  p_user_id uuid, p_old_code text, p_ticket_type_id smallint,
  p_performance_id smallint, p_schedule_id smallint,
  p_new_relationship_id smallint, p_issue_count smallint,
  p_codes text[], p_signatures text[], p_person_count smallint DEFAULT 1
) RETURNS TABLE(code text, signature text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ticket_id uuid; v_status public.ticket_status; v_ticket_type smallint;
  v_class_id smallint; v_round_id smallint; v_issued_by_user_id uuid;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user is required'; END IF;
  IF p_old_code IS NULL OR length(trim(p_old_code)) = 0 THEN RAISE EXCEPTION 'old_code is required'; END IF;
  IF p_issue_count IS NULL OR p_issue_count <> 1 THEN RAISE EXCEPTION 'issue_count must be 1'; END IF;
  IF p_codes IS NULL OR p_signatures IS NULL THEN RAISE EXCEPTION 'codes/signatures are required'; END IF;
  IF array_length(p_codes, 1) IS DISTINCT FROM p_issue_count OR array_length(p_signatures, 1) IS DISTINCT FROM p_issue_count THEN RAISE EXCEPTION 'codes/signatures length mismatch'; END IF;
  IF p_new_relationship_id IS NULL OR p_new_relationship_id <= 0 THEN RAISE EXCEPTION 'new_relationship_id must be positive'; END IF;

  SELECT t.id, t.status, t.ticket_type, t.issued_by_user_id
  INTO v_ticket_id, v_status, v_ticket_type, v_issued_by_user_id
  FROM public.tickets AS t WHERE t.code = p_old_code LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  IF v_status IS DISTINCT FROM 'valid' THEN RAISE EXCEPTION 'only valid tickets can be reissued'; END IF;
  IF v_ticket_type IS DISTINCT FROM p_ticket_type_id THEN RAISE EXCEPTION 'ticket_type mismatch'; END IF;

  IF p_ticket_type_id = 4 OR p_ticket_type_id = 7 THEN
    IF p_performance_id <> 0 OR p_schedule_id <> 0 THEN RAISE EXCEPTION 'admission-only ticket requires performanceId=0 and scheduleId=0'; END IF;
  ELSE
    SELECT ct.class_id, ct.round_id INTO v_class_id, v_round_id
    FROM public.class_tickets AS ct WHERE ct.id = v_ticket_id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'class ticket mapping not found'; END IF;
    IF v_class_id IS DISTINCT FROM p_performance_id OR v_round_id IS DISTINCT FROM p_schedule_id THEN RAISE EXCEPTION 'performance/schedule mismatch'; END IF;
  END IF;

  UPDATE public.tickets AS t SET status = 'cancelled', updated_at = now() WHERE t.id = v_ticket_id;
  RETURN QUERY SELECT issued.code, issued.signature
  FROM public.issue_class_tickets_with_codes(
    p_user_id, p_ticket_type_id, p_new_relationship_id, p_performance_id,
    p_schedule_id, p_issue_count, p_codes, p_signatures, p_person_count
  ) AS issued;
  UPDATE public.tickets AS t SET issued_by_user_id = v_issued_by_user_id
  WHERE t.code = p_codes[1] AND t.user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reissue_gym_ticket_change_relationship_with_codes(
  p_user_id uuid, p_old_code text, p_ticket_type_id smallint,
  p_performance_id smallint, p_schedule_id smallint,
  p_new_relationship_id smallint, p_issue_count smallint,
  p_codes text[], p_signatures text[], p_person_count smallint DEFAULT 1
) RETURNS TABLE(code text, signature text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ticket_id uuid; v_status public.ticket_status; v_ticket_type smallint;
  v_performance_id smallint; v_issued_by_user_id uuid;
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
  FROM public.tickets AS t WHERE t.code = p_old_code LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  IF v_status IS DISTINCT FROM 'valid' THEN RAISE EXCEPTION 'only valid tickets can be reissued'; END IF;
  IF v_ticket_type IS DISTINCT FROM p_ticket_type_id THEN RAISE EXCEPTION 'ticket_type mismatch'; END IF;

  SELECT gt.performance_id INTO v_performance_id
  FROM public.gym_tickets AS gt WHERE gt.id = v_ticket_id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'gym ticket mapping not found'; END IF;
  IF v_performance_id IS DISTINCT FROM p_performance_id THEN RAISE EXCEPTION 'performance mismatch'; END IF;

  UPDATE public.tickets AS t SET status = 'cancelled', updated_at = now() WHERE t.id = v_ticket_id;
  RETURN QUERY SELECT issued.code, issued.signature
  FROM public.issue_gym_tickets_with_codes(
    p_user_id, p_ticket_type_id, p_new_relationship_id, p_performance_id,
    p_schedule_id, p_issue_count, p_codes, p_signatures, p_person_count
  ) AS issued;
  UPDATE public.tickets AS t SET issued_by_user_id = v_issued_by_user_id
  WHERE t.code = p_codes[1] AND t.user_id = p_user_id;
END;
$$;
