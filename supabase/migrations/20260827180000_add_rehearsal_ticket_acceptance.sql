ALTER TABLE public.rehearsals
  ADD COLUMN IF NOT EXISTS is_ticket_accepting boolean NOT NULL DEFAULT true;
