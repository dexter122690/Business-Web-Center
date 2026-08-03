-- Public, branch-specific appointment links. A customer can submit a request,
-- but cannot read appointments, business data, or other customer details.

begin;

alter table public.scheduled_appointments
  add column if not exists client_response text not null default 'confirmed'
  check (client_response in ('confirmed', 'call', 'visit'));

-- Public requests do not have an authenticated staff user. Staff-created
-- appointments still retain created_by as before.
alter table public.scheduled_appointments alter column created_by drop not null;

create table if not exists public.branch_appointment_links (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  public_token uuid not null unique default gen_random_uuid(),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branch_appointment_links_business_branch_key unique (business_id, branch_id)
);

drop trigger if exists set_branch_appointment_links_updated_at on public.branch_appointment_links;
create trigger set_branch_appointment_links_updated_at before update on public.branch_appointment_links
for each row execute procedure public.set_updated_at();

alter table public.branch_appointment_links enable row level security;

drop policy if exists branch_appointment_links_read on public.branch_appointment_links;
create policy branch_appointment_links_read on public.branch_appointment_links for select to authenticated
using (public.is_platform_admin() or public.is_business_member(business_id));

drop policy if exists branch_appointment_links_manage on public.branch_appointment_links;
create policy branch_appointment_links_manage on public.branch_appointment_links for all to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id))
with check (public.is_platform_admin() or public.is_business_manager(business_id));

create or replace function public.submit_public_appointment(
  p_token uuid,
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
  select l.business_id, l.branch_id into target_business, target_branch
  from public.branch_appointment_links l
  join public.businesses b on b.id = l.business_id
  join public.branches br on br.id = l.branch_id and br.business_id = l.business_id
  where l.public_token = p_token and l.enabled = true and b.status = 'active' and br.is_active = true;

  if target_business is null then
    raise exception 'This appointment link is no longer active.';
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

revoke all on function public.submit_public_appointment(uuid,date,time,text,text,text,text,text,text,text,text) from public;
grant execute on function public.submit_public_appointment(uuid,date,time,text,text,text,text,text,text,text,text) to anon, authenticated;

commit;
