-- クラス・部活ごとの管理者アカウント。必ずどちらか一方の公演にのみ紐づける。
CREATE TABLE IF NOT EXISTS public.organization_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  class_performance_id smallint REFERENCES public.class_performances(id) ON DELETE CASCADE,
  gym_performance_id smallint REFERENCES public.gym_performances(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_admins_one_performance CHECK (
    (class_performance_id IS NOT NULL AND gym_performance_id IS NULL) OR
    (class_performance_id IS NULL AND gym_performance_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.organization_admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_admin_id uuid NOT NULL REFERENCES public.organization_admins(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_admin_sessions_active_idx
  ON public.organization_admin_sessions (token_hash, expires_at)
  WHERE revoked_at IS NULL;

REVOKE ALL ON public.organization_admins, public.organization_admin_sessions FROM anon, authenticated;

COMMENT ON TABLE public.organization_admins IS
  '団体管理者。password_hash は bcrypt ハッシュを保存する。作成は運営管理者が行う。';
