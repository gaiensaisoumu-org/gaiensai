CREATE OR REPLACE FUNCTION public.get_public_performance_acceptance()
RETURNS TABLE (performance_type text, performance_id smallint, is_accepting boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  WITH settings AS (
    SELECT is_active FROM public.configs ORDER BY id LIMIT 1
  ), controls AS (
    SELECT
      class_invite_mode,
      rehearsal_invite_mode,
      same_day_class_mode,
      junior_class_mode,
      gym_invite_mode,
      same_day_gym_mode,
      junior_gym_mode
    FROM public.ticket_issue_controls
    WHERE id = 1
  )
  SELECT
    'class'::text,
    cp.id,
    COALESCE(settings.is_active, false)
      AND (
        COALESCE(controls.class_invite_mode <> 'off', false)
        OR COALESCE(controls.rehearsal_invite_mode <> 'off', false)
        OR COALESCE(controls.same_day_class_mode <> 'off', false)
        OR COALESCE(controls.junior_class_mode <> 'off', false)
      )
      AND COALESCE(cp.is_accepting, false)
      AND EXISTS (
        SELECT 1
        FROM public.performances_schedule ps
        LEFT JOIN public.class_ticket_counters ctc
          ON ctc.class_id = cp.id AND ctc.round_id = ps.id
        WHERE ps.is_active = true
          AND cp.total_capacity > (
            COALESCE(ctc.issued_general, 0)
            + COALESCE(ctc.issued_junior, 0)
            + COALESCE(ctc.issued_other, 0)
          )
      )
  FROM public.class_performances cp
  CROSS JOIN settings
  CROSS JOIN controls

  UNION ALL

  SELECT
    'gym'::text,
    gp.id,
    COALESCE(settings.is_active, false)
      AND (
        COALESCE(controls.gym_invite_mode <> 'off', false)
        OR COALESCE(controls.same_day_gym_mode <> 'off', false)
        OR COALESCE(controls.junior_gym_mode <> 'off', false)
      )
      AND COALESCE(gp.is_accepting, false)
      AND gp.capacity > COALESCE(gtc.issued_count, 0)
  FROM public.gym_performances gp
  CROSS JOIN settings
  CROSS JOIN controls
  LEFT JOIN public.gym_ticket_counters gtc
    ON gtc.performance_id = gp.id;
$$;

REVOKE ALL ON FUNCTION public.get_public_performance_acceptance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_performance_acceptance() TO anon, authenticated, service_role;
