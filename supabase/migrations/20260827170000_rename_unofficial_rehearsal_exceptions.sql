-- 適用済みDB内の関数が返す「自主リハーサル」の文言を更新する。
CREATE OR REPLACE FUNCTION public.update_unofficial_rehearsal(
  p_id smallint, p_class_id smallint, p_round_name text, p_start_time timestamptz,
  p_end_time timestamptz, p_capacity smallint
) RETURNS public.rehearsals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result public.rehearsals;
BEGIN
  PERFORM 1 FROM public.rehearsals WHERE id = p_id AND class_id = p_class_id AND type = 'unofficial' AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '編集できる非公式公開リハーサルが見つかりません。'; END IF;
  IF (SELECT start_time <= now() FROM public.rehearsals WHERE id = p_id) THEN RAISE EXCEPTION '開始済みのリハーサルは編集できません。'; END IF;
  IF btrim(coalesce(p_round_name, '')) = '' THEN RAISE EXCEPTION 'リハーサル名を入力してください。'; END IF;
  IF p_start_time <= now() OR p_end_time <= p_start_time OR p_capacity <= 0 THEN RAISE EXCEPTION '入力内容が不正です。'; END IF;
  IF p_capacity < (SELECT active_ticket_count FROM public.rehearsals WHERE id = p_id) THEN RAISE EXCEPTION '現在有効なチケット数を下回る定員には変更できません。'; END IF;
  UPDATE public.rehearsals SET round_name = btrim(p_round_name), start_time = p_start_time, end_time = p_end_time, capacity = p_capacity
    WHERE id = p_id RETURNING * INTO v_result;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.delete_or_deactivate_unofficial_rehearsal(
  p_id smallint,
  p_class_id smallint
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_round smallint; v_issued boolean;
BEGIN
  SELECT round_id INTO v_round FROM public.rehearsals WHERE id = p_id AND class_id = p_class_id AND type = 'unofficial' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '操作できる非公式公開リハーサルが見つかりません。'; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.class_tickets ct
    JOIN public.tickets t ON t.id = ct.id
    JOIN public.ticket_types tt ON tt.id = t.ticket_type
    WHERE ct.class_id = p_class_id AND ct.round_id = v_round
      AND tt.name = 'クラス公演(リハーサル)'
  ) INTO v_issued;
  IF v_issued THEN UPDATE public.rehearsals SET is_active = false WHERE id = p_id;
  ELSE DELETE FROM public.rehearsals WHERE id = p_id; END IF;
  RETURN v_issued;
END $$;
