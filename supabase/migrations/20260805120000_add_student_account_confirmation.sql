-- 生徒が初回登録した学年・組・番号を確認済みかどうかを保持する。
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS account_confirmed boolean NOT NULL DEFAULT false;

-- ダッシュボードで利用する既存RPCに確認状態を含める。
CREATE OR REPLACE FUNCTION public.get_student_dashboard()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, auth
AS $$
  WITH dashboard_user AS (
    SELECT id, affiliation, clubs, account_confirmed
    FROM public.users
    WHERE id = auth.uid() AND role = 'student'
  ),
  valid_tickets AS (
    SELECT id, code, signature, relationship, created_at, ticket_name
    FROM public.tickets
    WHERE user_id = auth.uid() AND status = 'valid'
  )
  SELECT jsonb_build_object(
    'profile', (SELECT to_jsonb(dashboard_user) FROM dashboard_user),
    'config', (SELECT jsonb_build_object(
      'is_active', is_active,
      'show_length', show_length,
      'max_tickets_per_user', max_tickets_per_user,
      'max_tickets_per_gym_user', max_tickets_per_gym_user
    ) FROM public.configs ORDER BY id LIMIT 1),
    'controls', (SELECT jsonb_build_object(
      'class_invite_mode', class_invite_mode,
      'rehearsal_invite_mode', rehearsal_invite_mode,
      'gym_invite_mode', gym_invite_mode,
      'entry_only_mode', entry_only_mode
    ) FROM public.ticket_issue_controls WHERE id = 1),
    'class_ticket_count', (SELECT count(*) FROM public.class_tickets ct JOIN valid_tickets t ON t.id = ct.id),
    'gym_ticket_count', (SELECT count(*) FROM public.gym_tickets gt JOIN valid_tickets t ON t.id = gt.id),
    'tickets', coalesce((SELECT jsonb_agg(to_jsonb(valid_tickets) ORDER BY created_at DESC) FROM valid_tickets), '[]'::jsonb),
    'class_performances', coalesce((SELECT jsonb_agg(jsonb_build_object('id', cp.id, 'class_name', cp.class_name, 'title', cp.title)) FROM public.class_performances cp JOIN public.class_tickets ct ON ct.class_id = cp.id JOIN valid_tickets t ON t.id = ct.id), '[]'::jsonb),
    'gym_performances', coalesce((SELECT jsonb_agg(jsonb_build_object('id', gp.id, 'group_name', gp.group_name, 'round_name', gp.round_name, 'start_at', gp.start_at, 'end_at', gp.end_at)) FROM public.gym_performances gp JOIN public.gym_tickets gt ON gt.performance_id = gp.id JOIN valid_tickets t ON t.id = gt.id), '[]'::jsonb),
    'schedules', coalesce((SELECT jsonb_agg(jsonb_build_object('id', ps.id, 'start_at', ps.start_at)) FROM public.performances_schedule ps JOIN public.class_tickets ct ON ct.round_id = ps.id JOIN valid_tickets t ON t.id = ct.id), '[]'::jsonb)
  )
  WHERE EXISTS (SELECT 1 FROM dashboard_user);
$$;

-- 認証済みの生徒本人だけが、自分の確認状態を更新できる。
CREATE OR REPLACE FUNCTION public.confirm_student_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, auth
AS $$
BEGIN
  UPDATE public.users
  SET account_confirmed = true
  WHERE id = auth.uid() AND role = 'student';

  IF NOT FOUND THEN
    RAISE EXCEPTION '生徒アカウントが見つかりません。';
  END IF;
END;
$$;

-- 初回登録画面で確認を済ませてから登録する生徒は、作成時点で確認済みにする。
CREATE OR REPLACE FUNCTION public.register_student(
  affiliation integer,
  clubs text[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, auth
AS $$
BEGIN
  INSERT INTO public.users (
    id,
    email,
    affiliation,
    role,
    clubs,
    account_confirmed
  )
  VALUES (
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    affiliation,
    'student',
    clubs,
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_dashboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_dashboard() TO authenticated;
REVOKE ALL ON FUNCTION public.confirm_student_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_student_account() TO authenticated;
