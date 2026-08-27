-- 開始済みリハーサルのキャンセル制限は、リハーサル券にだけ適用する。
-- 当日クラス公演券も class_tickets の同じ class_id / round_id を使うため、
-- 券種の判定なしに rehearsals と結合すると誤ってブロックされてしまう。
CREATE OR REPLACE FUNCTION public.prevent_late_rehearsal_ticket_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz;
BEGIN
  IF OLD.status = 'valid'
    AND NEW.status = 'cancelled'
    AND EXISTS (
      SELECT 1
      FROM public.ticket_types
      WHERE id = OLD.ticket_type
        AND name = 'クラス公演(リハーサル)'
    ) THEN
    SELECT r.start_time
      INTO v_start
      FROM public.class_tickets ct
      JOIN public.rehearsals r
        ON r.class_id = ct.class_id
       AND r.round_id = ct.round_id
      WHERE ct.id = OLD.id;

    IF v_start IS NOT NULL AND now() >= v_start THEN
      RAISE EXCEPTION '開始時刻を過ぎたリハーサルのチケットはキャンセルできません。';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
