-- 公開リハで追加したテーブルも、他の public テーブルと同様に RLS を有効化する。
ALTER TABLE public.rehearsal_round_names ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rehearsal_used_rounds ENABLE ROW LEVEL SECURITY;

-- 回名は発券画面で選択肢として参照するだけなので、読み取りのみ許可する。
DROP POLICY IF EXISTS "rehearsal_round_names_read" ON public.rehearsal_round_names;
CREATE POLICY "rehearsal_round_names_read"
  ON public.rehearsal_round_names
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- rehearsal_used_rounds は SECURITY DEFINER の関数だけが操作する内部管理テーブル。
-- クライアント向けのポリシーは作成しない。
