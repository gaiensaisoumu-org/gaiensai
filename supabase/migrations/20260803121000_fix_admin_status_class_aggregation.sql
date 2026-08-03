-- Keep the original dashboard function as a base and replace only its
-- class aggregation. This prevents a class from being split into multiple
-- rows when individual students have different ticket counts.
ALTER FUNCTION public.get_admin_status_dashboard()
  RENAME TO get_admin_status_dashboard_base;

CREATE OR REPLACE FUNCTION public.get_admin_status_dashboard()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
WITH student_accounts AS (
  SELECT split_part(email, '@', 1)::integer AS affiliation
  FROM auth.users
  WHERE email ~ '^[1-3][0-9]{4}@gaiensai\.local$'
),
student_profiles AS (
  SELECT id, affiliation
  FROM public.users
  WHERE role = 'student'
),
valid_tickets AS (
  SELECT id, user_id, person_count
  FROM public.tickets
  WHERE status = 'valid'
),
class_account_rows AS (
  SELECT
    format('%s-%s', affiliation / 10000, (affiliation / 100) % 100) AS name,
    count(*) AS account_count
  FROM student_accounts
  GROUP BY 1
),
class_initial_rows AS (
  SELECT
    format('%s-%s', affiliation / 10000, (affiliation / 100) % 100) AS name,
    count(*) AS initial_count
  FROM student_profiles
  GROUP BY 1
),
class_ticket_rows AS (
  SELECT
    format('%s-%s', sp.affiliation / 10000, (sp.affiliation / 100) % 100) AS name,
    count(vt.id) AS ticket_count,
    coalesce(sum(vt.person_count), 0) AS visitor_count
  FROM student_profiles sp
  JOIN valid_tickets vt ON vt.user_id = sp.id
  GROUP BY 1
),
class_rows AS (
  SELECT
    car.name,
    car.account_count,
    coalesce(cir.initial_count, 0) AS initial_count,
    coalesce(ctr.ticket_count, 0) AS ticket_count,
    coalesce(ctr.visitor_count, 0) AS visitor_count
  FROM class_account_rows car
  LEFT JOIN class_initial_rows cir ON cir.name = car.name
  LEFT JOIN class_ticket_rows ctr ON ctr.name = car.name
)
SELECT public.get_admin_status_dashboard_base()
  || jsonb_build_object(
    'classes',
    coalesce(
      (SELECT jsonb_agg(to_jsonb(class_rows) ORDER BY name) FROM class_rows),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_admin_status_dashboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_status_dashboard() TO service_role;
