-- Let a client choose any active branch of the business connected to the
-- public appointment link. The link never grants access to business data.

begin;

create or replace function public.get_public_appointment_branches(p_token uuid)
returns table (branch_id uuid, branch_name text)
language sql
security definer
set search_path = public
as $$
  select br.id, br.name
  from public.branch_appointment_links link
  join public.businesses b on b.id = link.business_id
  join public.branches br on br.business_id = b.id
  where link.public_token = p_token
    and link.enabled = true
    and b.status = 'active'
    and br.is_active = true
  order by br.name;
$$;

revoke all on function public.get_public_appointment_branches(uuid) from public;
grant execute on function public.get_public_appointment_branches(uuid) to anon, authenticated;

/* The original 11-parameter function remains for older public pages. */
create or replace function public.submit_public_appointment(
  p_token uuid,
  p_branch_id uuid,
  p_scheduled_date date,
  p_scheduled_time time,
  p_client_name text,
  p_contact_number text,
  p_vehicle text,
  p_year_model text,
  p_color text,
  p_procedure text,
  p_notes text,
  p_response text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_business uuid;
  target_branch uuid;
  appointment_id uuid;
begin
  select link.business_id into target_business
  from public.branch_appointment_links link
  join public.businesses b on b.id = link.business_id
  where link.public_token = p_token and link.enabled = true and b.status = 'active';

  if target_business is null then
    raise exception 'This appointment link is no longer active.';
  end if;
  select br.id into target_branch
  from public.branches br
  where br.id = p_branch_id and br.business_id = target_business and br.is_active = true;
  if target_branch is null then
    raise exception 'Choose an active branch for this appointment.';
  end if;
  if p_scheduled_date is null or char_length(trim(coalesce(p_client_name, ''))) = 0
     or char_length(trim(coalesce(p_contact_number, ''))) = 0 or char_length(trim(coalesce(p_vehicle, ''))) = 0 then
    raise exception 'Please complete the date, name, contact number, and vehicle fields.';
  end if;
  if coalesce(p_response, '') not in ('confirmed', 'call', 'visit') then
    raise exception 'Choose your appointment preference.';
  end if;

  insert into public.scheduled_appointments (
    business_id, branch_id, scheduled_date, scheduled_time, client_name,
    contact_number, vehicle, year_model, color, procedure, notes,
    client_response, status, created_by
  ) values (
    target_business, target_branch, p_scheduled_date, p_scheduled_time, trim(p_client_name),
    trim(p_contact_number), trim(p_vehicle), nullif(trim(coalesce(p_year_model, '')), ''),
    nullif(trim(coalesce(p_color, '')), ''), nullif(trim(coalesce(p_procedure, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''), p_response, 'Scheduled', null
  ) returning id into appointment_id;

  return appointment_id;
end;
$$;

revoke all on function public.submit_public_appointment(uuid,uuid,date,time,text,text,text,text,text,text,text,text) from public;
grant execute on function public.submit_public_appointment(uuid,uuid,date,time,text,text,text,text,text,text,text,text) to anon, authenticated;

commit;
