-- Secure payroll data foundation for Business Web Center.
-- Run after schema.sql and migrations 002 through 005.
-- This creates the online payroll records; it does not delete or alter existing data.

begin;

create table if not exists public.payroll_workers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  employee_code text not null,
  full_name text not null,
  position text,
  pay_type text not null default 'daily_rate'
    check (pay_type in ('daily_rate', 'per_vehicle')),
  daily_rate numeric(14,2) not null default 0 check (daily_rate >= 0),
  retention_percent numeric(5,2) not null default 0
    check (retention_percent between 0 and 100),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, employee_code)
);

create table if not exists public.payroll_attendance (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  worker_id uuid not null references public.payroll_workers(id) on delete cascade,
  work_date date not null,
  time_in time,
  time_out time,
  regular_hours numeric(6,2) not null default 0 check (regular_hours >= 0),
  overtime_hours numeric(6,2) not null default 0 check (overtime_hours >= 0),
  regular_pay numeric(14,2) not null default 0 check (regular_pay >= 0),
  overtime_pay numeric(14,2) not null default 0 check (overtime_pay >= 0),
  overtime_approved boolean not null default false,
  photo_path text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (worker_id, work_date)
);

create table if not exists public.payroll_vehicle_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  worker_id uuid not null references public.payroll_workers(id) on delete restrict,
  invoice_id uuid references public.invoices(id) on delete set null,
  job_order_number text not null,
  vehicle text not null,
  plate_number text,
  service_work text,
  contract_amount numeric(14,2) not null default 0 check (contract_amount >= 0),
  retention_percent numeric(5,2) not null default 0
    check (retention_percent between 0 and 100),
  target_completion date,
  client_release_date date,
  status text not null default 'In Progress'
    check (status in ('Draft', 'In Progress', 'Completed', 'Released', 'Cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, job_order_number)
);

create table if not exists public.payroll_job_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  job_id uuid not null references public.payroll_vehicle_jobs(id) on delete cascade,
  payment_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.payroll_obligations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  worker_id uuid not null references public.payroll_workers(id) on delete restrict,
  obligation_type text not null check (obligation_type in ('cash_advance', 'loan')),
  reference text,
  original_amount numeric(14,2) not null check (original_amount > 0),
  planned_weekly_deduction numeric(14,2) not null default 0
    check (planned_weekly_deduction >= 0),
  status text not null default 'Open' check (status in ('Open', 'Paid', 'Cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payroll_obligation_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  obligation_id uuid not null references public.payroll_obligations(id) on delete cascade,
  payment_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  payroll_period_id uuid,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  schedule_type text not null default 'weekly'
    check (schedule_type in ('weekly', 'semi_monthly', 'monthly')),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'issued', 'void')),
  approved_at timestamptz,
  issued_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (business_id, period_start, period_end)
);

create table if not exists public.payslips (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  payroll_period_id uuid not null references public.payroll_periods(id) on delete restrict,
  worker_id uuid not null references public.payroll_workers(id) on delete restrict,
  payslip_number text not null,
  gross_earnings numeric(14,2) not null default 0 check (gross_earnings >= 0),
  deductions numeric(14,2) not null default 0 check (deductions >= 0),
  net_pay numeric(14,2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'approved', 'issued', 'void')),
  approved_at timestamptz,
  issued_at timestamptz,
  snapshot jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, payslip_number),
  unique (payroll_period_id, worker_id)
);

alter table public.payroll_obligation_payments
  drop constraint if exists payroll_obligation_payments_payroll_period_id_fkey;
alter table public.payroll_obligation_payments
  add constraint payroll_obligation_payments_payroll_period_id_fkey
  foreign key (payroll_period_id) references public.payroll_periods(id) on delete set null;

create index if not exists payroll_workers_business_idx
  on public.payroll_workers (business_id, is_active, full_name);
create index if not exists payroll_attendance_business_date_idx
  on public.payroll_attendance (business_id, work_date desc);
create index if not exists payroll_jobs_business_idx
  on public.payroll_vehicle_jobs (business_id, worker_id, status);
create index if not exists payroll_obligations_business_idx
  on public.payroll_obligations (business_id, worker_id, status);
create index if not exists payroll_periods_business_date_idx
  on public.payroll_periods (business_id, period_end desc);
create index if not exists payslips_business_worker_idx
  on public.payslips (business_id, worker_id, created_at desc);

alter table public.payroll_workers enable row level security;
alter table public.payroll_attendance enable row level security;
alter table public.payroll_vehicle_jobs enable row level security;
alter table public.payroll_job_payments enable row level security;
alter table public.payroll_obligations enable row level security;
alter table public.payroll_obligation_payments enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payslips enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'payroll_workers', 'payroll_attendance', 'payroll_vehicle_jobs',
    'payroll_job_payments', 'payroll_obligations', 'payroll_obligation_payments',
    'payroll_periods', 'payslips'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_manage', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_platform_admin() or public.is_business_member(business_id))',
      table_name || '_read', table_name
    );
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_platform_admin() or public.is_business_manager(business_id)) with check (public.is_platform_admin() or public.is_business_manager(business_id))',
      table_name || '_manage', table_name
    );
  end loop;
end $$;

drop trigger if exists set_payroll_workers_updated_at on public.payroll_workers;
create trigger set_payroll_workers_updated_at before update on public.payroll_workers
for each row execute procedure public.set_updated_at();
drop trigger if exists set_payroll_attendance_updated_at on public.payroll_attendance;
create trigger set_payroll_attendance_updated_at before update on public.payroll_attendance
for each row execute procedure public.set_updated_at();
drop trigger if exists set_payroll_vehicle_jobs_updated_at on public.payroll_vehicle_jobs;
create trigger set_payroll_vehicle_jobs_updated_at before update on public.payroll_vehicle_jobs
for each row execute procedure public.set_updated_at();
drop trigger if exists set_payroll_obligations_updated_at on public.payroll_obligations;
create trigger set_payroll_obligations_updated_at before update on public.payroll_obligations
for each row execute procedure public.set_updated_at();
drop trigger if exists set_payroll_periods_updated_at on public.payroll_periods;
create trigger set_payroll_periods_updated_at before update on public.payroll_periods
for each row execute procedure public.set_updated_at();
drop trigger if exists set_payslips_updated_at on public.payslips;
create trigger set_payslips_updated_at before update on public.payslips
for each row execute procedure public.set_updated_at();

commit;
