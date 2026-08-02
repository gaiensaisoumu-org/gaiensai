-- 中学生IDを12bit分散格納できる範囲へ拡張する。
-- classBits=15 は当日券フラグと衝突するため採番対象から除外する。
CREATE OR REPLACE FUNCTION public.issue_junior_id() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  next_id integer;
  min_id integer := 100001;
  max_id integer := 103839;
BEGIN
  LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE;

  SELECT coalesce(max(affiliation), min_id - 1) + 1
    INTO next_id
  FROM public.users
  WHERE role = 'junior';

  -- affiliation - 100000 の Bit6..9 が 1111 の範囲は当日券用欠番。
  WHILE next_id <= max_id
    AND (((next_id - 100000) >> 6) & 15) = 15 LOOP
    next_id := next_id + 1;
  END LOOP;

  IF next_id > max_id THEN
    RAISE EXCEPTION 'ID_LIMIT_REACHED';
  END IF;

  RETURN next_id;
END;
$$;

ALTER FUNCTION public.issue_junior_id() OWNER TO postgres;
