-- 展示部活を開催年度ごとに識別・表示するための年度情報。
ALTER TABLE public.exhibition_clubs
  ADD COLUMN year smallint NOT NULL DEFAULT 2026;
