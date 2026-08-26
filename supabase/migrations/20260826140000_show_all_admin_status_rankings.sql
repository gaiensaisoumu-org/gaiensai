-- 管理画面の発券ランキングは上位件数で打ち切らず、すべての集計結果を表示する。
ALTER TABLE public.tickets
  ADD COLUMN junior_relationship smallint
  CHECK (junior_relationship BETWEEN 0 AND 2);

-- 既存の中学生券も、利用者設定または人数から判別できる区分を補完する。
UPDATE public.tickets AS t
SET junior_relationship = CASE
  WHEN t.person_count = 2 THEN 2
  WHEN u.junior_usage_type = 2 THEN 0
  WHEN u.junior_usage_type = 3 THEN 1
END
FROM public.users AS u,
     public.ticket_types AS tt
WHERE t.user_id = u.id
  AND tt.id = t.ticket_type
  AND tt.type = '中学生券'
  AND t.junior_relationship IS NULL;

CREATE OR REPLACE FUNCTION public.set_junior_ticket_relationships(
  p_codes text[],
  p_relationships smallint[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF cardinality(p_codes) IS DISTINCT FROM cardinality(p_relationships) THEN
    RAISE EXCEPTION 'チケットコードと中学生券利用者区分の件数が一致しません。';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_relationships) AS relationship
    WHERE relationship NOT BETWEEN 0 AND 2
  ) THEN
    RAISE EXCEPTION '中学生券利用者区分が不正です。';
  END IF;

  UPDATE public.tickets AS t
  SET junior_relationship = relationship_values.relationship
  FROM unnest(p_codes, p_relationships) AS relationship_values(code, relationship)
  WHERE t.code = relationship_values.code;
END;
$$;

REVOKE ALL ON FUNCTION public.set_junior_ticket_relationships(text[], smallint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_junior_ticket_relationships(text[], smallint[]) TO service_role;

CREATE OR REPLACE FUNCTION public.get_admin_status_dashboard_base() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public, auth
AS $$
WITH rehearsal_ticket_type AS (
  SELECT id FROM public.ticket_types
  WHERE name = 'クラス公演(リハーサル)'
  LIMIT 1
), student_accounts AS (
  SELECT split_part(email, '@', 1)::integer AS affiliation
  FROM auth.users
  WHERE email ~ '^[1-3][0-9]{4}@gaiensai\.local$'
), student_profiles AS (
  SELECT id, affiliation, clubs FROM public.users WHERE role = 'student'
), all_tickets AS (
  SELECT t.*
  FROM public.tickets t
  WHERE t.ticket_type IS DISTINCT FROM (SELECT id FROM rehearsal_ticket_type)
), valid_tickets AS (
  SELECT * FROM all_tickets WHERE status = 'valid'
), class_ticket_rows AS (
  SELECT sp.affiliation, count(vt.id) AS ticket_count,
         coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM student_profiles sp
  JOIN valid_tickets vt ON vt.user_id = sp.id
  GROUP BY sp.affiliation
), class_rows AS (
  SELECT format('%s-%s', sa.affiliation / 10000, (sa.affiliation / 100) % 100) AS name,
         count(*) AS account_count, count(sp.id) AS initial_count,
         coalesce(ctr.ticket_count, 0) AS ticket_count,
         coalesce(ctr.visitor_count, 0) AS visitor_count
  FROM student_accounts sa
  LEFT JOIN student_profiles sp ON sp.affiliation = sa.affiliation
  LEFT JOIN class_ticket_rows ctr ON ctr.affiliation = sa.affiliation
  GROUP BY 1, ctr.ticket_count, ctr.visitor_count
), club_rows AS (
  SELECT club AS name, count(DISTINCT sp.id) AS account_count,
         count(vt.id) AS ticket_count,
         coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM student_profiles sp
  CROSS JOIN LATERAL unnest(coalesce(sp.clubs, ARRAY[]::text[])) AS club
  LEFT JOIN valid_tickets vt ON vt.user_id = sp.id
  GROUP BY club
), performance_rows AS (
  SELECT cp.class_name AS name, count(vt.id) AS ticket_count,
         coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM valid_tickets vt
  JOIN public.class_tickets ct ON ct.id = vt.id
  JOIN public.class_performances cp ON cp.id = ct.class_id
  GROUP BY cp.class_name
  UNION ALL
  SELECT gp.group_name AS name, count(vt.id), coalesce(sum(vt.person_count), 0)
  FROM valid_tickets vt
  JOIN public.gym_tickets gt ON gt.id = vt.id
  JOIN public.gym_performances gp ON gp.id = gt.performance_id
  GROUP BY gp.group_name
  UNION ALL
  SELECT '入場専用券' AS name, count(vt.id), coalesce(sum(vt.person_count), 0)
  FROM valid_tickets vt
  WHERE NOT EXISTS (SELECT 1 FROM public.class_tickets ct WHERE ct.id = vt.id)
    AND NOT EXISTS (SELECT 1 FROM public.gym_tickets gt WHERE gt.id = vt.id)
), ticket_performance_rows AS (
  SELECT cp.class_name AS name, count(vt.id) AS ticket_count,
         coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM valid_tickets vt
  JOIN public.class_tickets ct ON ct.id = vt.id
  JOIN public.class_performances cp ON cp.id = ct.class_id
  GROUP BY cp.class_name
), gym_performance_rows AS (
  SELECT gp.group_name AS name, count(vt.id) AS ticket_count,
         coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM valid_tickets vt
  JOIN public.gym_tickets gt ON gt.id = vt.id
  JOIN public.gym_performances gp ON gp.id = gt.performance_id
  GROUP BY gp.group_name
), time_rows AS (
  SELECT time_source.name, sum(time_source.ticket_count) AS ticket_count,
         sum(time_source.visitor_count) AS visitor_count
  FROM (
    SELECT ps.round_name || '（' ||
           to_char(ps.start_at AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI') || '）' AS name,
           count(vt.id) AS ticket_count,
           coalesce(sum(vt.person_count), 0) AS visitor_count
    FROM valid_tickets vt
    JOIN public.class_tickets ct ON ct.id = vt.id
    JOIN public.performances_schedule ps ON ps.id = ct.round_id
    GROUP BY ps.round_name, ps.start_at
    UNION ALL
    SELECT gp.group_name || ' / ' || gp.round_name || '（' ||
           to_char(gp.start_at AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI') || '）',
           count(vt.id), coalesce(sum(vt.person_count), 0)
    FROM valid_tickets vt
    JOIN public.gym_tickets gt ON gt.id = vt.id
    JOIN public.gym_performances gp ON gp.id = gt.performance_id
    GROUP BY gp.group_name, gp.round_name, gp.start_at
  ) AS time_source
  GROUP BY time_source.name
), relationship_rows AS (
  SELECT coalesce(
           CASE vt.junior_relationship
             WHEN 0 THEN '中学生'
             WHEN 1 THEN '保護者'
             WHEN 2 THEN '中学生と保護者'
           END,
           r.name
         ) AS name,
         count(vt.id) AS ticket_count,
         coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM valid_tickets vt
  JOIN public.ticket_types tt ON tt.id = vt.ticket_type
  LEFT JOIN public.relationships r ON r.id = vt.relationship
  GROUP BY 1
), ticket_type_rows AS (
  SELECT tt.type || ' ' || tt.name AS name, count(vt.id) AS ticket_count,
         coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM valid_tickets vt
  JOIN public.ticket_types tt ON tt.id = vt.ticket_type
  GROUP BY tt.type, tt.name
)
SELECT jsonb_build_object(
  'overview', jsonb_build_object(
    'studentAccounts', (SELECT count(*) FROM student_accounts),
    'initialRegistrations', (SELECT count(*) FROM student_profiles),
    'juniorRegistrations', (SELECT count(*) FROM public.users WHERE role = 'junior'),
    'issuedTickets', (SELECT count(*) FROM all_tickets),
    'validTickets', (SELECT count(*) FROM valid_tickets),
    'validVisitors', (SELECT coalesce(sum(person_count), 0) FROM valid_tickets),
    'cancelledTickets', (SELECT count(*) FROM all_tickets WHERE status <> 'valid')
  ),
  'classes', coalesce((SELECT jsonb_agg(to_jsonb(class_rows) ORDER BY name) FROM class_rows), '[]'::jsonb),
  'clubs', coalesce((SELECT jsonb_agg(to_jsonb(club_rows) ORDER BY ticket_count DESC, name) FROM club_rows), '[]'::jsonb),
  'rankings', jsonb_build_object(
    'performances', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM performance_rows ORDER BY ticket_count DESC, name) x), '[]'::jsonb),
    'ticketPerformances', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM ticket_performance_rows ORDER BY ticket_count DESC, name) x), '[]'::jsonb),
    'gymPerformances', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM gym_performance_rows ORDER BY ticket_count DESC, name) x), '[]'::jsonb),
    'times', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM time_rows ORDER BY ticket_count DESC, name) x), '[]'::jsonb),
    'relationships', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM relationship_rows ORDER BY ticket_count DESC, name) x), '[]'::jsonb),
    'ticketTypes', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM ticket_type_rows ORDER BY ticket_count DESC, name) x), '[]'::jsonb)
  )
);
$$;
