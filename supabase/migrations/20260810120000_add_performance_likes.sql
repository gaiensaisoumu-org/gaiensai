ALTER TABLE public.class_performances ADD COLUMN IF NOT EXISTS "like" integer NOT NULL DEFAULT 0 CHECK ("like" >= 0);
ALTER TABLE public.gym_performances ADD COLUMN IF NOT EXISTS "like" integer NOT NULL DEFAULT 0 CHECK ("like" >= 0);
ALTER TABLE public.exhibition_clubs ADD COLUMN IF NOT EXISTS "like" integer NOT NULL DEFAULT 0 CHECK ("like" >= 0);
ALTER TABLE public.exhibition_clubs ADD COLUMN IF NOT EXISTS location text;

CREATE OR REPLACE FUNCTION public.change_performance_like(p_type text, p_id smallint, p_delta integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_count integer;
BEGIN
  IF p_delta NOT IN (-1, 1) OR p_type NOT IN ('class', 'gym', 'club') THEN RAISE EXCEPTION 'invalid like change'; END IF;
  IF p_type = 'class' THEN UPDATE class_performances SET "like" = GREATEST("like" + p_delta, 0) WHERE id = p_id RETURNING "like" INTO next_count;
  ELSIF p_type = 'gym' THEN UPDATE gym_performances SET "like" = GREATEST("like" + p_delta, 0) WHERE id = p_id RETURNING "like" INTO next_count;
  ELSE UPDATE exhibition_clubs SET "like" = GREATEST("like" + p_delta, 0) WHERE id = p_id RETURNING "like" INTO next_count;
  END IF;
  IF next_count IS NULL THEN RAISE EXCEPTION 'performance not found'; END IF;
  RETURN next_count;
END; $$;
GRANT EXECUTE ON FUNCTION public.change_performance_like(text, smallint, integer) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.get_public_performance_acceptance();
CREATE FUNCTION public.get_public_performance_acceptance()
RETURNS TABLE(performance_type text, performance_id smallint, is_accepting boolean, like_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'class', id, is_accepting, "like" FROM class_performances
  UNION ALL SELECT 'gym', id, is_accepting, "like" FROM gym_performances
  UNION ALL SELECT 'club', id, NULL::boolean, "like" FROM exhibition_clubs;
$$;
GRANT EXECUTE ON FUNCTION public.get_public_performance_acceptance() TO anon, authenticated;
