-- Per-business feature controls and customer-management notes.
-- Run after schema.sql and the earlier migrations.

begin;

create table if not exists public.business_management (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  enabled_features jsonb not null default '{"invoices":true,"reports":true,"clients":true,"expenses":true,"feedback":true,"quotations":true,"payroll":true,"schedule":true}'::jsonb,
  billing_status text not null default 'pending'
    check (billing_status in ('pending', 'paid', 'overdue', 'complimentary')),
  admin_notes text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_business_management_updated_at on public.business_management;
create trigger set_business_management_updated_at
before update on public.business_management
for each row execute procedure public.set_updated_at();

alter table public.business_management enable row level security;

drop policy if exists business_management_read on public.business_management;
create policy business_management_read on public.business_management
for select to authenticated
using (public.is_platform_admin() or public.is_business_member(business_id));

drop policy if exists business_management_admin_manage on public.business_management;
create policy business_management_admin_manage on public.business_management
for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

commit;
