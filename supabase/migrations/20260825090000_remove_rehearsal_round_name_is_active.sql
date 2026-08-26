ALTER TABLE public.rehearsal_round_names
  DROP COLUMN IF EXISTS is_active;

-- PostgREST が古い列定義を保持しないよう、スキーマキャッシュを更新する。
NOTIFY pgrst, 'reload schema';
