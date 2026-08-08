-- 体育館公演の他部活向け上限を、部活単位で管理する。
ALTER TABLE public.configs
  ADD COLUMN IF NOT EXISTS max_tickets_per_other_club_user smallint;

UPDATE public.configs
SET max_tickets_per_other_club_user = max_tickets_per_gym_user
WHERE max_tickets_per_other_club_user IS NULL;

ALTER TABLE public.configs
  ALTER COLUMN max_tickets_per_other_club_user SET NOT NULL,
  ALTER COLUMN max_tickets_per_other_club_user SET DEFAULT 20;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'configs_max_tickets_per_other_club_user_check'
      AND conrelid = 'public.configs'::regclass
  ) THEN
    ALTER TABLE public.configs
      ADD CONSTRAINT configs_max_tickets_per_other_club_user_check
      CHECK (max_tickets_per_other_club_user BETWEEN 0 AND 100);
  END IF;
END $$;
