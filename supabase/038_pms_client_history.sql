-- PMS client history, stored separately for every business and branch.
begin;

create table if not exists public.pms_service_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  invoice_id uuid not null unique references public.invoices(id) on delete cascade,
  client_name text not null,
  contact_number text,
  client_email text,
  vehicle_make text,
  vehicle_year_model text,
  vehicle_color text,
  plate_number text,
  service_date date not null,
  odometer_km numeric(12,2) check (odometer_km is null or odometer_km >= 0),
  technician_worker_id uuid references public.payroll_workers(id) on delete set null,
  technician_name text,
  next_pms_date date,
  next_pms_odometer_km numeric(12,2) check (next_pms_odometer_km is null or next_pms_odometer_km >= 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pms_service_records_branch_date_idx on public.pms_service_records (business_id, branch_id, service_date desc);
alter table public.pms_service_records enable row level security;
drop policy if exists pms_service_records_select on public.pms_service_records;
create policy pms_service_records_select on public.pms_service_records for select using (public.can_view_invoice_branch(business_id, branch_id));
drop policy if exists pms_service_records_manage on public.pms_service_records;
create policy pms_service_records_manage on public.pms_service_records for all using (public.can_manage_invoice_branch(business_id, branch_id)) with check (public.can_manage_invoice_branch(business_id, branch_id));
drop trigger if exists set_pms_service_records_updated_at on public.pms_service_records;
create trigger set_pms_service_records_updated_at before update on public.pms_service_records for each row execute function public.set_updated_at();
commit;
