-- 20260828110000 適用済み環境にも、追加した共有キャッシュ項目を反映する。
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
    'performance_acceptance', COALESCE((
      SELECT jsonb_agg(to_jsonb(pa) ORDER BY pa.performance_type, pa.performance_id)
      FROM get_public_performance_acceptance() pa
    ), '[]'::jsonb),
    'admission_only_junior_account_count', COALESCE((
      SELECT admission_only_count
      FROM junior_admission_only_account_counts
      WHERE id = 1
    ), 0),
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
GRANT EXECUTE ON FUNCTION public.get_cloudflare_app_data_snapshot()
  TO anon, authenticated, service_role;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'class_performances', 'gym_performances', 'exhibition_clubs',
    'junior_admission_only_account_counts'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename = table_name
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        table_name
      );
    END IF;
  END LOOP;
END $$;
