-- 同一公演回における「本人」向けクラス公演招待券・ログイン中の当日券の重複を防ぐ。
-- Edge Function の事前チェックだけでは同時リクエストを防げないため、
-- class_tickets への紐付け時にもトランザクション内で検証する。
CREATE OR REPLACE FUNCTION public.prevent_duplicate_self_class_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid;
  v_relationship_id integer;
  v_ticket_type_id integer;
BEGIN
  SELECT user_id, relationship, ticket_type
    INTO v_user_id, v_relationship_id, v_ticket_type_id
    FROM public.tickets
   WHERE id = NEW.id;

  IF v_user_id = '00000000-0000-0000-0000-00000000d001'::uuid
     OR v_relationship_id IS DISTINCT FROM 1
     OR NOT EXISTS (
       SELECT 1
         FROM public.ticket_types
        WHERE id = v_ticket_type_id
          AND (
            (name = 'クラス公演(当日)' AND type = '招待券')
            OR (name = 'クラス公演' AND type = '当日券')
          )
     ) THEN
    RETURN NEW;
  END IF;

  -- 同じ利用者・公演回の発券を直列化し、同時送信によるすり抜けを防ぐ。
  PERFORM pg_advisory_xact_lock(
    hashtext(v_user_id::text || ':' || NEW.round_id::text)
  );

  IF EXISTS (
    SELECT 1
      FROM public.tickets AS t
      JOIN public.class_tickets AS ct ON ct.id = t.id
     WHERE t.user_id = v_user_id
       AND t.status = 'valid'
       AND t.relationship = 1
       AND ct.round_id = NEW.round_id
       AND ct.class_id <> NEW.class_id
  ) THEN
    RAISE EXCEPTION
      '同じ公演回の別クラス公演について、本人分のチケットが既に発券されています。';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_duplicate_self_class_invite
  ON public.class_tickets;

CREATE TRIGGER prevent_duplicate_self_class_invite
BEFORE INSERT ON public.class_tickets
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_self_class_invite();
