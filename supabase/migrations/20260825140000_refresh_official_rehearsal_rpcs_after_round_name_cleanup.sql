-- rehearsal_round_names.is_active を廃止した後も、古い関数定義が
-- 同カラムを参照しないよう公開リハ用RPCを再定義する。
CREATE OR REPLACE FUNCTION public.create_official_rehearsal(
  p_class_id smallint, p_round_name text, p_start_time timestamptz,
  p_end_time timestamptz, p_capacity smallint
) RETURNS public.rehearsals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_round smallint; v_result public.rehearsals; v_start timestamptz; v_end timestamptz;
BEGIN
  SELECT start_time, end_time INTO v_start, v_end
  FROM public.rehearsal_round_names
  WHERE name = btrim(coalesce(p_round_name, ''));
  IF NOT FOUND OR v_start IS NULL OR v_end IS NULL THEN RAISE EXCEPTION '公開リハの回名と開始・終了時刻を設定してください。'; END IF;
  IF v_start <= now() THEN RAISE EXCEPTION '開始時刻は未来の日時を指定してください。'; END IF;
  IF v_end <= v_start THEN RAISE EXCEPTION '終了時刻は開始時刻より後にしてください。'; END IF;
  IF p_capacity IS NULL OR p_capacity <= 0 THEN RAISE EXCEPTION '定員は1以上で指定してください。'; END IF;
  PERFORM pg_advisory_xact_lock(94117, p_class_id);
  SELECT n::smallint INTO v_round FROM generate_series(0, 15) n
  WHERE NOT EXISTS (SELECT 1 FROM public.rehearsals r WHERE r.class_id = p_class_id AND r.round_id = n)
    AND NOT EXISTS (SELECT 1 FROM public.rehearsal_used_rounds u WHERE u.class_id = p_class_id AND u.round_id = n)
  ORDER BY n LIMIT 1;
  IF v_round IS NULL THEN RAISE EXCEPTION '作成できるリハーサル回は1クラス16件までです。'; END IF;
  INSERT INTO public.rehearsals (class_id, round_id, round_name, start_time, end_time, capacity, type, is_active)
  VALUES (p_class_id, v_round, btrim(p_round_name), v_start, v_end, p_capacity, 'official', true)
  RETURNING * INTO v_result;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.update_official_rehearsal(
  p_id smallint, p_round_name text, p_start_time timestamptz,
  p_end_time timestamptz, p_capacity smallint
) RETURNS public.rehearsals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result public.rehearsals; v_start timestamptz; v_end timestamptz;
BEGIN
  PERFORM 1 FROM public.rehearsals WHERE id = p_id AND type = 'official' AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '編集できる公開リハが見つかりません。'; END IF;
  IF (SELECT start_time <= now() FROM public.rehearsals WHERE id = p_id) THEN RAISE EXCEPTION '開始済みの公開リハは編集できません。'; END IF;
  SELECT start_time, end_time INTO v_start, v_end
  FROM public.rehearsal_round_names
  WHERE name = btrim(coalesce(p_round_name, ''));
  IF NOT FOUND OR v_start IS NULL OR v_end IS NULL OR v_start <= now() OR v_end <= v_start THEN RAISE EXCEPTION '公開リハの回名に有効な開始・終了時刻が設定されていません。'; END IF;
  IF p_capacity IS NULL OR p_capacity <= 0 THEN RAISE EXCEPTION '定員は1以上で指定してください。'; END IF;
  IF p_capacity < (SELECT active_ticket_count FROM public.rehearsals WHERE id = p_id) THEN RAISE EXCEPTION '現在有効なチケット数を下回る定員には変更できません。'; END IF;
  UPDATE public.rehearsals
  SET round_name = btrim(p_round_name), start_time = v_start, end_time = v_end, capacity = p_capacity
  WHERE id = p_id
  RETURNING * INTO v_result;
  RETURN v_result;
END $$;
