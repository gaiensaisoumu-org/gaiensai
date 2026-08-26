-- Availability is derived from these public rows. Publish only the data that
-- can change the public availability RPC; ticket rows and personal data are
-- intentionally excluded.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'class_ticket_counters',
    'gym_ticket_counters',
    'class_performances',
    'performances_schedule',
    'gym_performances',
    'configs'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = table_name
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        table_name
      );
    END IF;
  END LOOP;
END;
$$;
