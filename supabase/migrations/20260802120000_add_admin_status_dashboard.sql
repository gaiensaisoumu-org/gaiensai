-- Aggregated data for the password-protected admin status dashboard.
-- This is intentionally only executable by service_role; the edge function
-- verifies the control-panel session before it calls this function.
CREATE OR REPLACE FUNCTION public.get_admin_status_dashboard()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
WITH student_accounts AS (
  SELECT
    split_part(email, '@', 1)::integer AS affiliation
  FROM auth.users
  WHERE email ~ '^[1-3][0-9]{4}@gaiensai\.local$'
),
student_profiles AS (
  SELECT id, affiliation, clubs
  FROM public.users
  WHERE role = 'student'
),
valid_tickets AS (
  SELECT t.*
  FROM public.tickets t
  WHERE t.status = 'valid'
),
class_ticket_rows AS (
  -- 発券者の所属は、初回登録済みの users.affiliation を基準にする。
  SELECT
    sp.affiliation,
    count(vt.id) AS ticket_count,
    coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM student_profiles sp
  JOIN valid_tickets vt ON vt.user_id = sp.id
  GROUP BY sp.affiliation
),
class_rows AS (
  SELECT
    format(
      '%s-%s',
      sa.affiliation / 10000,
      (sa.affiliation / 100) % 100
    ) AS name,
    count(*) AS account_count,
    count(sp.id) AS initial_count,
    coalesce(ctr.ticket_count, 0) AS ticket_count,
    coalesce(ctr.visitor_count, 0) AS visitor_count
  FROM student_accounts sa
  LEFT JOIN student_profiles sp ON sp.affiliation = sa.affiliation
  LEFT JOIN class_ticket_rows ctr ON ctr.affiliation = sa.affiliation
  GROUP BY 1, ctr.ticket_count, ctr.visitor_count
),
club_rows AS (
  SELECT
    club AS name,
    count(DISTINCT sp.id) AS account_count,
    count(vt.id) AS ticket_count,
    coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM student_profiles sp
  CROSS JOIN LATERAL unnest(coalesce(sp.clubs, ARRAY[]::text[])) AS club
  LEFT JOIN valid_tickets vt ON vt.user_id = sp.id
  GROUP BY club
),
performance_rows AS (
  SELECT cp.class_name AS name,
         count(vt.id) AS ticket_count, coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM valid_tickets vt
  JOIN public.class_tickets ct ON ct.id = vt.id
  JOIN public.class_performances cp ON cp.id = ct.class_id
  GROUP BY cp.class_name
  UNION ALL
  SELECT gp.group_name AS name,
         count(vt.id), coalesce(sum(vt.person_count), 0)
  FROM valid_tickets vt
  JOIN public.gym_tickets gt ON gt.id = vt.id
  JOIN public.gym_performances gp ON gp.id = gt.performance_id
  GROUP BY gp.group_name
  UNION ALL
  SELECT '入場専用券' AS name, count(vt.id), coalesce(sum(vt.person_count), 0)
  FROM valid_tickets vt
  WHERE NOT EXISTS (SELECT 1 FROM public.class_tickets ct WHERE ct.id = vt.id)
    AND NOT EXISTS (SELECT 1 FROM public.gym_tickets gt WHERE gt.id = vt.id)
),
ticket_performance_rows AS (
  SELECT
    cp.class_name AS name,
    count(vt.id) AS ticket_count,
    coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM valid_tickets vt
  JOIN public.class_tickets ct ON ct.id = vt.id
  JOIN public.class_performances cp ON cp.id = ct.class_id
  GROUP BY cp.class_name
),
gym_performance_rows AS (
  SELECT
    gp.group_name AS name,
    count(vt.id) AS ticket_count,
    coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM valid_tickets vt
  JOIN public.gym_tickets gt ON gt.id = vt.id
  JOIN public.gym_performances gp ON gp.id = gt.performance_id
  GROUP BY gp.group_name
),
time_rows AS (
  SELECT
    time_source.name,
    sum(time_source.ticket_count) AS ticket_count,
    sum(time_source.visitor_count) AS visitor_count
  FROM (
    SELECT
      ps.round_name || '（'
        || to_char(ps.start_at AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI')
        || '）' AS name,
      count(vt.id) AS ticket_count,
      coalesce(sum(vt.person_count), 0) AS visitor_count
    FROM valid_tickets vt
    JOIN public.class_tickets ct ON ct.id = vt.id
    JOIN public.performances_schedule ps ON ps.id = ct.round_id
    GROUP BY ps.round_name, ps.start_at
    UNION ALL
    SELECT
      gp.group_name || ' / ' || gp.round_name || '（'
        || to_char(gp.start_at AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI')
        || '）' AS name,
      count(vt.id),
      coalesce(sum(vt.person_count), 0)
    FROM valid_tickets vt
    JOIN public.gym_tickets gt ON gt.id = vt.id
    JOIN public.gym_performances gp ON gp.id = gt.performance_id
    GROUP BY gp.group_name, gp.round_name, gp.start_at
  ) AS time_source
  GROUP BY time_source.name
),
relationship_rows AS (
  SELECT r.name, count(vt.id) AS ticket_count, coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM valid_tickets vt JOIN public.relationships r ON r.id = vt.relationship
  GROUP BY r.name
),
ticket_type_rows AS (
  SELECT tt.type || ' ' || tt.name AS name,
         count(vt.id) AS ticket_count, coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM valid_tickets vt JOIN public.ticket_types tt ON tt.id = vt.ticket_type
  GROUP BY tt.type, tt.name
)
SELECT jsonb_build_object(
  'overview', jsonb_build_object(
    'studentAccounts', (SELECT count(*) FROM student_accounts),
    'initialRegistrations', (SELECT count(*) FROM student_profiles),
    'juniorRegistrations', (SELECT count(*) FROM public.users WHERE role = 'junior'),
    'issuedTickets', (SELECT count(*) FROM public.tickets),
    'validTickets', (SELECT count(*) FROM valid_tickets),
    'validVisitors', (SELECT coalesce(sum(person_count), 0) FROM valid_tickets),
    'cancelledTickets', (SELECT count(*) FROM public.tickets WHERE status <> 'valid')
  ),
  'classes', coalesce((SELECT jsonb_agg(to_jsonb(class_rows) ORDER BY name) FROM class_rows), '[]'::jsonb),
  'clubs', coalesce((SELECT jsonb_agg(to_jsonb(club_rows) ORDER BY ticket_count DESC, name) FROM club_rows), '[]'::jsonb),
  'rankings', jsonb_build_object(
    'performances', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM performance_rows ORDER BY ticket_count DESC, name LIMIT 10) x), '[]'::jsonb),
    'ticketPerformances', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM ticket_performance_rows ORDER BY ticket_count DESC, name LIMIT 10) x), '[]'::jsonb),
    'gymPerformances', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM gym_performance_rows ORDER BY ticket_count DESC, name LIMIT 10) x), '[]'::jsonb),
    'times', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM time_rows ORDER BY ticket_count DESC, name LIMIT 10) x), '[]'::jsonb),
    'relationships', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM relationship_rows ORDER BY ticket_count DESC, name) x), '[]'::jsonb),
    'ticketTypes', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM ticket_type_rows ORDER BY ticket_count DESC, name) x), '[]'::jsonb)
  )
);
$$;

REVOKE ALL ON FUNCTION public.get_admin_status_dashboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_status_dashboard() TO service_role;
