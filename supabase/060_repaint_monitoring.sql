-- Branch-scoped repaint monitoring.  These records are operational only and
-- do not create invoices, sales, expenses, or customer transactions.
begin;

create table if not exists public.repaint_monitoring_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  source_vehicle_job_id uuid references public.payroll_vehicle_jobs(id) on delete set null,
  vehicle_model text not null,
  plate_number text not null,
  work_label text not null check (work_label in ('Washover','Per Panel Work')),
  work_scope text,
  assigned_worker text,
  date_in date not null,
  target_completion_date date not null,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_completion_date >= date_in)
);

create table if not exists public.repaint_monitoring_days (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.repaint_monitoring_jobs(id) on delete cascade,
  day_number integer not null check (day_number > 0),
  progress_update text,
  delay_reason text not null default 'No current delay',
  delay_other text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, day_number),
  check (delay_reason in ('No current delay','Materials unavailable','Additional repair','Worker unavailable','Client approval pending','Equipment problem','Other')),
  check (delay_reason <> 'Other' or coalesce(length(trim(delay_other)),0) > 0)
);

create table if not exists public.repaint_monitoring_tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.repaint_monitoring_jobs(id) on delete cascade,
  day_number integer not null check (day_number between 1 and 14),
  task_number integer not null check (task_number > 0),
  task_label text not null,
  completed boolean not null default false,
  done_on date,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, day_number, task_number),
  check ((completed and done_on is not null) or (not completed and done_on is null))
);

create index if not exists repaint_monitoring_jobs_branch_idx on public.repaint_monitoring_jobs (business_id, branch_id, updated_at desc);
create index if not exists repaint_monitoring_days_job_idx on public.repaint_monitoring_days (job_id, day_number);
create index if not exists repaint_monitoring_tasks_job_idx on public.repaint_monitoring_tasks (job_id, day_number, task_number);

drop trigger if exists set_repaint_monitoring_jobs_updated_at on public.repaint_monitoring_jobs;
create trigger set_repaint_monitoring_jobs_updated_at before update on public.repaint_monitoring_jobs for each row execute procedure public.set_updated_at();
drop trigger if exists set_repaint_monitoring_days_updated_at on public.repaint_monitoring_days;
create trigger set_repaint_monitoring_days_updated_at before update on public.repaint_monitoring_days for each row execute procedure public.set_updated_at();
drop trigger if exists set_repaint_monitoring_tasks_updated_at on public.repaint_monitoring_tasks;
create trigger set_repaint_monitoring_tasks_updated_at before update on public.repaint_monitoring_tasks for each row execute procedure public.set_updated_at();

alter table public.repaint_monitoring_jobs enable row level security;
alter table public.repaint_monitoring_days enable row level security;
alter table public.repaint_monitoring_tasks enable row level security;

drop policy if exists repaint_jobs_read on public.repaint_monitoring_jobs;
create policy repaint_jobs_read on public.repaint_monitoring_jobs for select to authenticated using (public.is_platform_admin() or public.is_business_manager(business_id));
drop policy if exists repaint_jobs_manage on public.repaint_monitoring_jobs;
create policy repaint_jobs_manage on public.repaint_monitoring_jobs for all to authenticated using (public.is_platform_admin() or public.is_business_manager(business_id)) with check ((public.is_platform_admin() or public.is_business_manager(business_id)) and exists (select 1 from public.branches b where b.id=branch_id and b.business_id=business_id and b.is_active));

drop policy if exists repaint_days_read on public.repaint_monitoring_days;
create policy repaint_days_read on public.repaint_monitoring_days for select to authenticated using (exists (select 1 from public.repaint_monitoring_jobs j where j.id=job_id and (public.is_platform_admin() or public.is_business_manager(j.business_id))));
drop policy if exists repaint_days_manage on public.repaint_monitoring_days;
create policy repaint_days_manage on public.repaint_monitoring_days for all to authenticated using (exists (select 1 from public.repaint_monitoring_jobs j where j.id=job_id and (public.is_platform_admin() or public.is_business_manager(j.business_id)))) with check (exists (select 1 from public.repaint_monitoring_jobs j where j.id=job_id and (public.is_platform_admin() or public.is_business_manager(j.business_id))));

drop policy if exists repaint_tasks_read on public.repaint_monitoring_tasks;
create policy repaint_tasks_read on public.repaint_monitoring_tasks for select to authenticated using (exists (select 1 from public.repaint_monitoring_jobs j where j.id=job_id and (public.is_platform_admin() or public.is_business_manager(j.business_id))));
drop policy if exists repaint_tasks_manage on public.repaint_monitoring_tasks;
create policy repaint_tasks_manage on public.repaint_monitoring_tasks for all to authenticated using (exists (select 1 from public.repaint_monitoring_jobs j where j.id=job_id and (public.is_platform_admin() or public.is_business_manager(j.business_id)))) with check (exists (select 1 from public.repaint_monitoring_jobs j where j.id=job_id and (public.is_platform_admin() or public.is_business_manager(j.business_id))));

drop trigger if exists audit_repaint_monitoring_jobs on public.repaint_monitoring_jobs;
create trigger audit_repaint_monitoring_jobs after insert or update or delete on public.repaint_monitoring_jobs for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_repaint_monitoring_days on public.repaint_monitoring_days;
create trigger audit_repaint_monitoring_days after insert or update or delete on public.repaint_monitoring_days for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_repaint_monitoring_tasks on public.repaint_monitoring_tasks;
create trigger audit_repaint_monitoring_tasks after insert or update or delete on public.repaint_monitoring_tasks for each row execute procedure public.capture_business_audit();

commit;
