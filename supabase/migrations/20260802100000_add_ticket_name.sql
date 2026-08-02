ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS ticket_name text;

CREATE OR REPLACE FUNCTION public.set_ticket_name(
  ticket_code text,
  ticket_signature text,
  new_ticket_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new_ticket_name IS NOT NULL AND (
    char_length(new_ticket_name) > 100
    OR char_length(btrim(new_ticket_name)) = 0
  ) THEN
    RAISE EXCEPTION 'チケット名は1〜100文字で入力してください。';
  END IF;

  UPDATE public.tickets AS ticket
  SET
    ticket_name = NULLIF(btrim(new_ticket_name), ''),
    updated_at = now()
  WHERE ticket.code = ticket_code
    AND ticket.signature = ticket_signature;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'チケットが見つからないか、署名が正しくありません。';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_ticket_name(text, text, text)
  TO anon, authenticated;
