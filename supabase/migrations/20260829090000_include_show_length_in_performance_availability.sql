-- The availability tables use this value to determine when a class-performance
-- round has ended. Gym performances already supply their own end_at value.
CREATE OR REPLACE FUNCTION public.get_performance_availability()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT jsonb_build_object(
    'config', (
      SELECT jsonb_build_object(
        'junior_release_open', junior_release_open,
        'show_length', show_length
      )
      FROM public.configs
      ORDER BY id
      LIMIT 1
    ),
    'class_performances', coalesce((SELECT jsonb_agg(to_jsonb(cp) ORDER BY cp.id) FROM public.class_performances cp), '[]'::jsonb),
    'schedules', coalesce((SELECT jsonb_agg(to_jsonb(ps) ORDER BY ps.id) FROM public.performances_schedule ps), '[]'::jsonb),
    'class_counters', coalesce((SELECT jsonb_agg(to_jsonb(ctc)) FROM public.class_ticket_counters ctc), '[]'::jsonb),
    'gym_performances', coalesce((SELECT jsonb_agg(to_jsonb(gp) ORDER BY gp.start_at, gp.id) FROM public.gym_performances gp), '[]'::jsonb),
    'gym_counters', coalesce((SELECT jsonb_agg(to_jsonb(gtc)) FROM public.gym_ticket_counters gtc), '[]'::jsonb)
  );
$$;
