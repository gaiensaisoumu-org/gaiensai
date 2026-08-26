-- rehearsal_type はDBの列挙型、カウンタ側はtextのため明示変換して比較する。
CREATE OR REPLACE FUNCTION public.issue_rehearsal_ticket_with_code(
  p_user_id uuid, p_ticket_type_id smallint, p_relationship_id smallint,
  p_class_id smallint, p_round_id smallint, p_issue_count smallint,
  p_codes text[], p_signatures text[]
) RETURNS TABLE(code text, signature text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rehearsal public.rehearsals;
  v_ticket_id uuid;
  v_role text;
  v_mode text;
  v_limit integer;
  v_issued integer;
  i integer;
BEGIN
  IF p_relationship_id <> 1 THEN RAISE EXCEPTION 'リハーサルは本人分のみ発券できます。'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_types WHERE id = p_ticket_type_id AND name = 'クラス公演(リハーサル)') THEN RAISE EXCEPTION 'リハーサル用のチケット種別を指定してください。'; END IF;
  IF p_issue_count IS NULL OR p_issue_count <= 0 OR array_length(p_codes, 1) IS DISTINCT FROM p_issue_count OR array_length(p_signatures, 1) IS DISTINCT FROM p_issue_count THEN RAISE EXCEPTION '発券枚数またはチケット情報が不正です。'; END IF;
  SELECT * INTO v_rehearsal FROM public.rehearsals WHERE class_id = p_class_id AND round_id = p_round_id FOR UPDATE;
  IF NOT FOUND OR NOT v_rehearsal.is_active THEN RAISE EXCEPTION 'このリハーサルは中止または受付終了しています。'; END IF;
  IF now() >= v_rehearsal.start_time THEN RAISE EXCEPTION '開始時刻を過ぎたため発券できません。'; END IF;
  SELECT role INTO v_role FROM public.users WHERE id = p_user_id;
  IF v_role = 'junior' THEN RAISE EXCEPTION '中学生はリハーサルのチケットを取得できません。'; END IF;
  SELECT rehearsal_invite_mode INTO v_mode FROM public.ticket_issue_controls WHERE id = 1;
  IF (v_rehearsal.type = 'official' AND v_mode NOT IN ('open', 'public-rehearsals')) OR (v_rehearsal.type = 'unofficial' AND v_mode NOT IN ('open', 'self-rehearsals')) THEN RAISE EXCEPTION 'このリハーサルは現在発券できません。'; END IF;
  IF v_rehearsal.type = 'official' AND p_issue_count <> 1 THEN RAISE EXCEPTION '公開リハは1回につき1枚のみ発券できます。'; END IF;
  IF v_rehearsal.active_ticket_count + p_issue_count > v_rehearsal.capacity THEN RAISE EXCEPTION 'このリハーサルの残席が不足しています。'; END IF;

  INSERT INTO public.student_rehearsal_issue_counters (user_id, rehearsal_type, issued_count)
  VALUES (p_user_id, v_rehearsal.type::text, 0)
  ON CONFLICT (user_id, rehearsal_type) DO NOTHING;
  SELECT issued_count INTO v_issued
  FROM public.student_rehearsal_issue_counters
  WHERE user_id = p_user_id AND rehearsal_type = v_rehearsal.type::text FOR UPDATE;
  IF v_rehearsal.type = 'official' THEN
    SELECT max_official_rehearsal_tickets_per_user INTO v_limit FROM public.configs ORDER BY id LIMIT 1;
    IF v_issued + p_issue_count > v_limit THEN
      RAISE EXCEPTION '公開リハの発券上限に達しています（発券済み: %枚、上限: %枚）。', v_issued, v_limit;
    END IF;
  END IF;

  FOR i IN 1..p_issue_count LOOP
    INSERT INTO public.tickets (user_id, ticket_type, relationship, status, code, signature, person_count)
    VALUES (p_user_id, p_ticket_type_id, p_relationship_id, 'valid', p_codes[i], p_signatures[i], 1)
    RETURNING id INTO v_ticket_id;
    INSERT INTO public.class_tickets (id, class_id, round_id) VALUES (v_ticket_id, p_class_id, p_round_id);
  END LOOP;
  RETURN QUERY SELECT unnest(p_codes), unnest(p_signatures);
END $$;

GRANT EXECUTE ON FUNCTION public.issue_rehearsal_ticket_with_code(uuid,smallint,smallint,smallint,smallint,smallint,text[],text[]) TO service_role;
