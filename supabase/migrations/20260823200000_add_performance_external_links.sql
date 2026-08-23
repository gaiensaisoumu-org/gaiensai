ALTER TABLE public.class_performances
  ADD COLUMN IF NOT EXISTS external_links jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.gym_performances
  ADD COLUMN IF NOT EXISTS external_links jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.exhibition_clubs
  ADD COLUMN IF NOT EXISTS external_links jsonb NOT NULL DEFAULT '{}'::jsonb;
