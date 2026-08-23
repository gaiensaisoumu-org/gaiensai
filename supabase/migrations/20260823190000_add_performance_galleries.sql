ALTER TABLE public.class_performances
  ADD COLUMN IF NOT EXISTS gallery_paths text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE public.gym_performances
  ADD COLUMN IF NOT EXISTS gallery_paths text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE public.exhibition_clubs
  ADD COLUMN IF NOT EXISTS gallery_paths text[] NOT NULL DEFAULT ARRAY[]::text[];
