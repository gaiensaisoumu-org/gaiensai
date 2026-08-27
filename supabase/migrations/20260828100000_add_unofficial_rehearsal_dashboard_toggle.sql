ALTER TABLE public.configs
  ADD COLUMN IF NOT EXISTS show_unofficial_rehearsal_dashboard boolean NOT NULL DEFAULT true;
