-- Cloudflare Worker が共有可能な読み取りデータを一度に取得するための
-- スナップショット。認証情報や個人情報は返さない。
CREATE OR REPLACE FUNCTION public.get_cloudflare_app_data_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'configs', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) - 'admin_password' - 'junior_password')
      FROM configs c
    ), '[]'::jsonb),
    'flappy_leaderboard', COALESCE((
      SELECT jsonb_agg(to_jsonb(l) ORDER BY l.score DESC, l.created_at ASC)
      FROM (
        SELECT id, player_name, score, created_at
        FROM flappy_leaderboard
        ORDER BY score DESC, created_at ASC
        LIMIT 100
      ) l
    ), '[]'::jsonb),
    'rehearsal_round_names', COALESCE((
      SELECT jsonb_agg(to_jsonb(rn) ORDER BY rn.sort_order)
      FROM rehearsal_round_names rn
    ), '[]'::jsonb),
    'rehearsals', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(r) || jsonb_build_object(
          'class_performances', CASE WHEN cp.id IS NULL THEN NULL
            ELSE jsonb_build_object('class_name', cp.class_name, 'title', cp.title)
          END
        )
        ORDER BY r.start_time NULLS LAST, r.id
      )
      FROM rehearsals r
      LEFT JOIN class_performances cp ON cp.id = r.class_id
    ), '[]'::jsonb),
    'ticket_issue_controls', COALESCE((
      SELECT jsonb_agg(to_jsonb(tic) ORDER BY tic.id)
      FROM ticket_issue_controls tic
    ), '[]'::jsonb),
    -- QR の有効性確認に必要な列だけを公開する。
    'tickets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', t.code,
        'ticket_name', t.ticket_name,
        'status', t.status
      ))
      FROM tickets t
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.get_cloudflare_app_data_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cloudflare_app_data_snapshot() TO anon, authenticated, service_role;

-- Worker の Realtime 購読でキャッシュを即時更新できるようにする。
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'flappy_leaderboard', 'rehearsal_round_names', 'rehearsals',
    'ticket_issue_controls', 'tickets'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename = table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
    END IF;
  END LOOP;
END $$;
