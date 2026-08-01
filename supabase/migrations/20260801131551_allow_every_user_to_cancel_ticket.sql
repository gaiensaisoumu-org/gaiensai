set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.cancel_own_ticket_by_code(p_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_user uuid;
  v_status public.ticket_status;
begin
  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'code is required';
  end if;

  select id, user_id, status
  into v_id, v_user, v_status
  from public.tickets
  where code = p_code
  limit 1
  for update;

  if not found then
    raise exception 'ticket not found';
  end if;

  if v_status is distinct from 'valid' then
    raise exception 'only valid tickets can be cancelled';
  end if;

  update public.tickets
  set status = 'cancelled', updated_at = now()
  where id = v_id;

  return true;
end;
$function$
;


