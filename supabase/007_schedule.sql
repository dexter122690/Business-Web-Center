-- Secure appointment schedule for Business Web Center.
-- Run after migrations 002 through 006.

begin;

create table if not exists public.scheduled_appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  scheduled_date date not null,
  scheduled_time time,
  client_name text not null,
  contact_number text not null,
  vehicle text not null,
  year_model text,
  color text,
  procedure text,
  reference_number text,
  notes text,
  status text not null default 'Scheduled'
    check (status in ('Scheduled', 'Completed', 'Cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_appointments_business_date_idx
  on public.scheduled_appointments (business_id, scheduled_date, scheduled_time);

drop trigger if exists set_scheduled_appointments_updated_at on public.scheduled_appointments;
create trigger set_scheduled_appointments_updated_at
before update on public.scheduled_appointments
for each row execute procedure public.set_updated_at();

alter table public.scheduled_appointments enable row level security;

drop policy if exists scheduled_appointments_read on public.scheduled_appointments;
create policy scheduled_appointments_read on public.scheduled_appointments
for select to authenticated
using (public.is_platform_admin() or public.is_business_member(business_id));

drop policy if exists scheduled_appointments_manage on public.scheduled_appointments;
create policy scheduled_appointments_manage on public.scheduled_appointments
for all to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id))
with check (public.is_platform_admin() or public.is_business_manager(business_id));

commit;
