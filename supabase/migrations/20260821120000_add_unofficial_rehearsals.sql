-- Public (unofficial) rehearsals.  Round numbers are deliberately separate
-- from performances_schedule ids: they occupy the 0..15 ticket-code space per
-- class.
ALTER TABLE public.rehearsals
  ADD COLUMN IF NOT EXISTS end_time timestamptz,
  ADD COLUMN IF NOT EXISTS capacity smallint,
  ADD COLUMN IF NOT EXISTS active_ticket_count integer NOT NULL DEFAULT 0
    CHECK (active_ticket_count >= 0);

ALTER TABLE public.rehearsals
  DROP CONSTRAINT IF EXISTS rehearsals_round_id_range_check,
  ADD CONSTRAINT rehearsals_round_id_range_check
    CHECK (round_id IS NULL OR round_id BETWEEN 0 AND 15),
  DROP CONSTRAINT IF EXISTS rehearsals_unofficial_values_check,
  ADD CONSTRAINT rehearsals_unofficial_values_check CHECK (
    type <> 'unofficial' OR (
      round_id IS NOT NULL AND start_time IS NOT NULL AND end_time IS NOT NULL
      AND capacity IS NOT NULL AND capacity > 0 AND end_time > start_time
      AND btrim(round_name) <> ''
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS rehearsals_class_round_id_key
  ON public.rehearsals (class_id, round_id) WHERE round_id IS NOT NULL;

UPDATE public.rehearsals r
SET active_ticket_count = (
  SELECT count(*)
  FROM public.class_tickets ct
  JOIN public.tickets t ON t.id = ct.id
  WHERE ct.class_id = r.class_id
    AND ct.round_id = r.round_id
    AND t.status = 'valid'
    AND EXISTS (
      SELECT 1 FROM public.ticket_types tt
      WHERE tt.id = t.ticket_type AND tt.name = 'クラス公演(リハーサル)'
    )
)
WHERE r.type = 'unofficial';

-- class_tickets may now point at either a normal performance schedule or a
-- rehearsal round.  Existing normal-schedule validation remains in its issue
-- RPC; the rehearsal RPC below validates its own target.
ALTER TABLE public.class_tickets
  DROP CONSTRAINT IF EXISTS class_tickets_round_id_fkey;
ALTER TABLE public.class_ticket_counters
  DROP CONSTRAINT IF EXISTS class_ticket_counters_round_id_fkey;

CREATE OR REPLACE FUNCTION public.create_unofficial_rehearsal(
  p_class_id smallint, p_round_name text, p_start_time timestamptz,
  p_end_time timestamptz, p_capacity smallint
) RETURNS public.rehearsals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_round smallint; v_result public.rehearsals;
BEGIN
  IF btrim(coalesce(p_round_name, '')) = '' THEN RAISE EXCEPTION 'リハーサル名を入力してください。'; END IF;
  IF p_start_time IS NULL OR p_start_time <= now() THEN RAISE EXCEPTION '開始時刻は未来の日時を指定してください。'; END IF;
  IF p_end_time IS NULL OR p_end_time <= p_start_time THEN RAISE EXCEPTION '終了時刻は開始時刻より後にしてください。'; END IF;
  IF p_capacity IS NULL OR p_capacity <= 0 THEN RAISE EXCEPTION '定員は1以上で指定してください。'; END IF;
  PERFORM pg_advisory_xact_lock(94117, p_class_id);
  SELECT n::smallint INTO v_round FROM generate_series(0, 15) n
  WHERE NOT EXISTS (SELECT 1 FROM public.rehearsals r WHERE r.class_id = p_class_id AND r.round_id = n)
  ORDER BY n LIMIT 1;
  IF v_round IS NULL THEN RAISE EXCEPTION '作成できるリハーサル回は1クラス16件までです。'; END IF;
  INSERT INTO public.rehearsals (class_id, round_id, round_name, start_time, end_time, capacity, type, is_active)
  VALUES (p_class_id, v_round, btrim(p_round_name), p_start_time, p_end_time, p_capacity, 'unofficial', true)
  RETURNING * INTO v_result;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.update_unofficial_rehearsal(
  p_id smallint, p_class_id smallint, p_round_name text, p_start_time timestamptz,
  p_end_time timestamptz, p_capacity smallint
) RETURNS public.rehearsals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result public.rehearsals;
BEGIN
  PERFORM 1 FROM public.rehearsals WHERE id = p_id AND class_id = p_class_id AND type = 'unofficial' AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '編集できる自主リハーサルが見つかりません。'; END IF;
  IF (SELECT start_time <= now() FROM public.rehearsals WHERE id = p_id) THEN RAISE EXCEPTION '開始済みのリハーサルは編集できません。'; END IF;
  IF btrim(coalesce(p_round_name, '')) = '' THEN RAISE EXCEPTION 'リハーサル名を入力してください。'; END IF;
  IF p_start_time <= now() OR p_end_time <= p_start_time OR p_capacity <= 0 THEN RAISE EXCEPTION '入力内容が不正です。'; END IF;
  IF p_capacity < (SELECT active_ticket_count FROM public.rehearsals WHERE id = p_id) THEN RAISE EXCEPTION '現在有効なチケット数を下回る定員には変更できません。'; END IF;
  UPDATE public.rehearsals SET round_name = btrim(p_round_name), start_time = p_start_time, end_time = p_end_time, capacity = p_capacity
    WHERE id = p_id RETURNING * INTO v_result;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.delete_or_deactivate_unofficial_rehearsal(p_id smallint, p_class_id smallint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_round smallint; v_issued boolean;
BEGIN
  SELECT round_id INTO v_round FROM public.rehearsals WHERE id = p_id AND class_id = p_class_id AND type = 'unofficial' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '操作できる自主リハーサルが見つかりません。'; END IF;
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

CREATE OR REPLACE FUNCTION public.issue_rehearsal_ticket_with_code(
  p_user_id uuid, p_ticket_type_id smallint, p_relationship_id smallint,
  p_class_id smallint, p_round_id smallint, p_issue_count smallint,
  p_codes text[], p_signatures text[]
) RETURNS TABLE(code text, signature text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rehearsal public.rehearsals; v_ticket_id uuid; i integer;
BEGIN
  IF p_relationship_id <> 1 THEN RAISE EXCEPTION '自主リハーサルは本人分のみ発券できます。'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_types WHERE id = p_ticket_type_id AND name = 'クラス公演(リハーサル)') THEN RAISE EXCEPTION '自主リハーサル用のチケット種別を指定してください。'; END IF;
  IF p_issue_count IS NULL OR p_issue_count <= 0 OR array_length(p_codes, 1) IS DISTINCT FROM p_issue_count OR array_length(p_signatures, 1) IS DISTINCT FROM p_issue_count THEN RAISE EXCEPTION '発券枚数またはチケット情報が不正です。'; END IF;
  SELECT * INTO v_rehearsal FROM public.rehearsals WHERE class_id = p_class_id AND round_id = p_round_id AND type = 'unofficial' FOR UPDATE;
  IF NOT FOUND OR NOT v_rehearsal.is_active THEN RAISE EXCEPTION 'この自主リハーサルは中止または受付終了しています。'; END IF;
  IF now() >= v_rehearsal.start_time THEN RAISE EXCEPTION '開始時刻を過ぎたため発券できません。'; END IF;
  IF v_rehearsal.active_ticket_count + p_issue_count > v_rehearsal.capacity THEN RAISE EXCEPTION 'この自主リハーサルの残席が不足しています。'; END IF;
  FOR i IN 1..p_issue_count LOOP
    INSERT INTO public.tickets (user_id, ticket_type, relationship, status, code, signature, person_count)
      VALUES (p_user_id, p_ticket_type_id, p_relationship_id, 'valid', p_codes[i], p_signatures[i], 1) RETURNING id INTO v_ticket_id;
    INSERT INTO public.class_tickets (id, class_id, round_id) VALUES (v_ticket_id, p_class_id, p_round_id);
  END LOOP;
  RETURN QUERY SELECT unnest(p_codes), unnest(p_signatures);
END $$;

-- Keep the current valid-ticket count on the rehearsal itself.  This avoids a
-- separate availability view and makes the capacity check a single locked row.
CREATE OR REPLACE FUNCTION public.sync_rehearsal_active_ticket_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_class_id smallint; v_round_id smallint; v_delta integer := 0; v_ticket_type smallint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- class_tickets is inserted after tickets, so INSERT is counted by its
    -- own trigger below.
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    v_ticket_type := OLD.ticket_type;
    IF OLD.status = 'valid' THEN v_delta := -1; END IF;
    SELECT class_id, round_id INTO v_class_id, v_round_id FROM public.class_tickets WHERE id = OLD.id;
  ELSE
    v_ticket_type := NEW.ticket_type;
    IF OLD.status = NEW.status THEN RETURN NEW; END IF;
    v_delta := CASE WHEN NEW.status = 'valid' THEN 1 WHEN OLD.status = 'valid' THEN -1 ELSE 0 END;
    SELECT class_id, round_id INTO v_class_id, v_round_id FROM public.class_tickets WHERE id = NEW.id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_types WHERE id = v_ticket_type AND name = 'クラス公演(リハーサル)') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF v_delta <> 0 AND v_class_id IS NOT NULL THEN
    UPDATE public.rehearsals SET active_ticket_count = active_ticket_count + v_delta
      WHERE class_id = v_class_id AND round_id = v_round_id AND type = 'unofficial';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sync_rehearsal_active_ticket_count ON public.tickets;
CREATE TRIGGER sync_rehearsal_active_ticket_count
  AFTER UPDATE OF status OR DELETE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.sync_rehearsal_active_ticket_count();

CREATE OR REPLACE FUNCTION public.count_new_rehearsal_ticket()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tickets t
    JOIN public.ticket_types tt ON tt.id = t.ticket_type
    WHERE t.id = NEW.id AND t.status = 'valid'
      AND tt.name = 'クラス公演(リハーサル)'
  ) THEN
    UPDATE public.rehearsals SET active_ticket_count = active_ticket_count + 1
      WHERE class_id = NEW.class_id AND round_id = NEW.round_id AND type = 'unofficial';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS count_new_rehearsal_ticket ON public.class_tickets;
CREATE TRIGGER count_new_rehearsal_ticket
  AFTER INSERT ON public.class_tickets
  FOR EACH ROW EXECUTE FUNCTION public.count_new_rehearsal_ticket();

-- Rehearsal tickets must never consume a student's normal class-performance
-- issuance quota.  The existing counter triggers operate on class_tickets, so
-- explicitly exclude this ticket type in both the insert and status-change
-- paths.
CREATE OR REPLACE FUNCTION public.refresh_student_ticket_issue_counter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE issuer_id uuid; target_id smallint; v_ticket_type smallint;
BEGIN
  SELECT issued_by_user_id, ticket_type INTO issuer_id, v_ticket_type
  FROM public.tickets WHERE id = NEW.id AND status = 'valid';
  IF TG_ARGV[0] = 'class' AND EXISTS (
    SELECT 1 FROM public.ticket_types
    WHERE id = v_ticket_type AND name = 'クラス公演(リハーサル)'
  ) THEN RETURN NEW; END IF;
  target_id := CASE WHEN TG_ARGV[0] = 'class'
    THEN (to_jsonb(NEW)->>'class_id')::smallint
    ELSE (to_jsonb(NEW)->>'performance_id')::smallint END;
  IF issuer_id IS NOT NULL AND target_id IS NOT NULL THEN
    INSERT INTO public.student_ticket_issue_counters(user_id, performance_type, performance_id, issued_count)
    VALUES (issuer_id, TG_ARGV[0], target_id, 1)
    ON CONFLICT (user_id, performance_type, performance_id)
    DO UPDATE SET issued_count = public.student_ticket_issue_counters.issued_count + 1;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.sync_student_ticket_issue_counter_on_ticket_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_id smallint;
  counter_type text;
  old_issuer_id uuid;
  new_issuer_id uuid;
  v_ticket_id uuid;
  v_ticket_type smallint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_ticket_id := OLD.id;
    v_ticket_type := OLD.ticket_type;
  ELSE
    v_ticket_id := NEW.id;
    v_ticket_type := NEW.ticket_type;
  END IF;

  SELECT 'class', class_id INTO counter_type, target_id
  FROM public.class_tickets WHERE id = v_ticket_id;
  IF counter_type = 'class' AND EXISTS (SELECT 1 FROM public.ticket_types WHERE id = v_ticket_type AND name = 'クラス公演(リハーサル)') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF counter_type IS NULL THEN
    SELECT 'gym', performance_id INTO counter_type, target_id
    FROM public.gym_tickets WHERE id = v_ticket_id;
  END IF;
  IF counter_type IS NULL THEN IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  old_issuer_id := OLD.issued_by_user_id; new_issuer_id := NEW.issued_by_user_id;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.status = 'valid' AND NEW.status <> 'valid') THEN
    INSERT INTO public.student_ticket_issue_counters(user_id, performance_type, performance_id, issued_count) VALUES (old_issuer_id, counter_type, target_id, 0)
    ON CONFLICT (user_id, performance_type, performance_id) DO UPDATE SET issued_count = greatest(public.student_ticket_issue_counters.issued_count - 1, 0);
  ELSIF TG_OP = 'UPDATE' AND OLD.status <> 'valid' AND NEW.status = 'valid' THEN
    INSERT INTO public.student_ticket_issue_counters(user_id, performance_type, performance_id, issued_count) VALUES (new_issuer_id, counter_type, target_id, 1)
    ON CONFLICT (user_id, performance_type, performance_id) DO UPDATE SET issued_count = public.student_ticket_issue_counters.issued_count + 1;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'valid' AND NEW.status = 'valid' AND OLD.issued_by_user_id IS DISTINCT FROM NEW.issued_by_user_id THEN
    INSERT INTO public.student_ticket_issue_counters(user_id, performance_type, performance_id, issued_count) VALUES (old_issuer_id, counter_type, target_id, 0)
    ON CONFLICT (user_id, performance_type, performance_id) DO UPDATE SET issued_count = greatest(public.student_ticket_issue_counters.issued_count - 1, 0);
    INSERT INTO public.student_ticket_issue_counters(user_id, performance_type, performance_id, issued_count) VALUES (new_issuer_id, counter_type, target_id, 1)
    ON CONFLICT (user_id, performance_type, performance_id) DO UPDATE SET issued_count = public.student_ticket_issue_counters.issued_count + 1;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

UPDATE public.student_ticket_issue_counters c
SET issued_count = (
  SELECT count(*) FROM public.tickets t
  JOIN public.class_tickets ct ON ct.id = t.id
  WHERE t.issued_by_user_id = c.user_id AND t.status = 'valid'
    AND ct.class_id = c.performance_id
    AND NOT EXISTS (SELECT 1 FROM public.ticket_types tt WHERE tt.id = t.ticket_type AND tt.name = 'クラス公演(リハーサル)')
)
WHERE c.performance_type = 'class';

-- Applies to the existing cancel_own_ticket_by_code RPC as well as any future
-- cancellation path, so a client cannot bypass the start-time rule.
CREATE OR REPLACE FUNCTION public.prevent_late_rehearsal_ticket_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_start timestamptz;
BEGIN
  IF OLD.status = 'valid' AND NEW.status = 'cancelled' THEN
    SELECT r.start_time INTO v_start FROM public.class_tickets ct
      JOIN public.rehearsals r ON r.class_id = ct.class_id AND r.round_id = ct.round_id
      WHERE ct.id = OLD.id AND r.type = 'unofficial';
    IF v_start IS NOT NULL AND now() >= v_start THEN
      RAISE EXCEPTION '開始時刻を過ぎた自主リハーサルのチケットはキャンセルできません。';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS prevent_late_rehearsal_ticket_cancellation ON public.tickets;
CREATE TRIGGER prevent_late_rehearsal_ticket_cancellation
  BEFORE UPDATE OF status ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.prevent_late_rehearsal_ticket_cancellation();

GRANT EXECUTE ON FUNCTION public.create_unofficial_rehearsal(smallint,text,timestamptz,timestamptz,smallint), public.update_unofficial_rehearsal(smallint,smallint,text,timestamptz,timestamptz,smallint), public.delete_or_deactivate_unofficial_rehearsal(smallint,smallint), public.issue_rehearsal_ticket_with_code(uuid,smallint,smallint,smallint,smallint,smallint,text[],text[]) TO service_role;
REVOKE ALL ON FUNCTION public.create_unofficial_rehearsal(smallint,text,timestamptz,timestamptz,smallint), public.update_unofficial_rehearsal(smallint,smallint,text,timestamptz,timestamptz,smallint), public.delete_or_deactivate_unofficial_rehearsal(smallint,smallint), public.issue_rehearsal_ticket_with_code(uuid,smallint,smallint,smallint,smallint,smallint,text[],text[]) FROM anon, authenticated;
