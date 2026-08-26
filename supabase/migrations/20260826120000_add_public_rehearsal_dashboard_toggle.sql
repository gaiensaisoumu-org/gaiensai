ALTER TABLE public.configs
  ADD COLUMN IF NOT EXISTS show_public_rehearsal_dashboard boolean NOT NULL DEFAULT true;
