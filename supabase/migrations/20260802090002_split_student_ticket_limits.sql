ALTER TABLE public.configs
  ADD COLUMN IF NOT EXISTS max_tickets_per_gym_user smallint;

UPDATE public.configs
SET max_tickets_per_gym_user = max_tickets_per_user
WHERE max_tickets_per_gym_user IS NULL;

ALTER TABLE public.configs
  ALTER COLUMN max_tickets_per_gym_user SET NOT NULL,
  ALTER COLUMN max_tickets_per_gym_user SET DEFAULT 8;
