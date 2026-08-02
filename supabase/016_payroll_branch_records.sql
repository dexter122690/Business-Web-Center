-- Keep every payroll record inside its selected branch.
-- Run after migrations 013 through 015.
begin;

alter table public.payroll_workers add column if not exists branch_id uuid references public.branches(id) on delete restrict;
alter table public.payroll_attendance add column if not exists branch_id uuid references public.branches(id) on delete restrict;
alter table public.payroll_vehicle_jobs add column if not exists branch_id uuid references public.branches(id) on delete restrict;
alter table public.payroll_job_payments add column if not exists branch_id uuid references public.branches(id) on delete restrict;
alter table public.payroll_obligations add column if not exists branch_id uuid references public.branches(id) on delete restrict;
alter table public.payroll_obligation_payments add column if not exists branch_id uuid references public.branches(id) on delete restrict;
alter table public.payroll_periods add column if not exists branch_id uuid references public.branches(id) on delete restrict;
alter table public.payslips add column if not exists branch_id uuid references public.branches(id) on delete restrict;

update public.payroll_workers t set branch_id=(select br.id from public.branches br where br.business_id=t.business_id order by br.created_at limit 1) where t.branch_id is null;
update public.payroll_attendance t set branch_id=w.branch_id from public.payroll_workers w where w.id=t.worker_id and t.branch_id is null;
update public.payroll_vehicle_jobs t set branch_id=w.branch_id from public.payroll_workers w where w.id=t.worker_id and t.branch_id is null;
update public.payroll_job_payments t set branch_id=j.branch_id from public.payroll_vehicle_jobs j where j.id=t.job_id and t.branch_id is null;
update public.payroll_obligations t set branch_id=w.branch_id from public.payroll_workers w where w.id=t.worker_id and t.branch_id is null;
update public.payroll_obligation_payments t set branch_id=o.branch_id from public.payroll_obligations o where o.id=t.obligation_id and t.branch_id is null;
update public.payroll_periods t set branch_id=(select br.id from public.branches br where br.business_id=t.business_id order by br.created_at limit 1) where t.branch_id is null;
update public.payslips t set branch_id=p.branch_id from public.payroll_periods p where p.id=t.payroll_period_id and t.branch_id is null;

alter table public.payroll_workers alter column branch_id set not null;
alter table public.payroll_attendance alter column branch_id set not null;
alter table public.payroll_vehicle_jobs alter column branch_id set not null;
alter table public.payroll_job_payments alter column branch_id set not null;
alter table public.payroll_obligations alter column branch_id set not null;
alter table public.payroll_obligation_payments alter column branch_id set not null;
alter table public.payroll_periods alter column branch_id set not null;
alter table public.payslips alter column branch_id set not null;

alter table public.payroll_workers drop constraint if exists payroll_workers_business_id_employee_code_key;
alter table public.payroll_vehicle_jobs drop constraint if exists payroll_vehicle_jobs_business_id_job_order_number_key;
alter table public.payroll_periods drop constraint if exists payroll_periods_business_id_period_start_period_end_key;
alter table public.payslips drop constraint if exists payslips_business_id_payslip_number_key;
create unique index if not exists payroll_workers_business_branch_code_key on public.payroll_workers (business_id,branch_id,employee_code);
create unique index if not exists payroll_jobs_business_branch_number_key on public.payroll_vehicle_jobs (business_id,branch_id,job_order_number);
create unique index if not exists payroll_periods_business_branch_dates_key on public.payroll_periods (business_id,branch_id,period_start,period_end);
create unique index if not exists payslips_business_branch_number_key on public.payslips (business_id,branch_id,payslip_number);

create index if not exists payroll_workers_branch_idx on public.payroll_workers (branch_id,is_active,full_name);
create index if not exists payroll_attendance_branch_date_idx on public.payroll_attendance (branch_id,work_date desc);
create index if not exists payroll_jobs_branch_idx on public.payroll_vehicle_jobs (branch_id,worker_id,status);
create index if not exists payroll_job_payments_branch_idx on public.payroll_job_payments (branch_id,payment_date);
create index if not exists payroll_obligations_branch_idx on public.payroll_obligations (branch_id,worker_id,status);
create index if not exists payroll_obligation_payments_branch_idx on public.payroll_obligation_payments (branch_id,payment_date);
create index if not exists payroll_periods_branch_date_idx on public.payroll_periods (branch_id,period_end desc);
create index if not exists payslips_branch_worker_idx on public.payslips (branch_id,worker_id,created_at desc);

do $$
declare table_name text;
begin
  foreach table_name in array array['payroll_workers','payroll_attendance','payroll_vehicle_jobs','payroll_job_payments','payroll_obligations','payroll_obligation_payments','payroll_periods','payslips'] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_manage', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_platform_admin() or (public.is_business_member(business_id) and exists (select 1 from public.branches br where br.id=branch_id and br.business_id=business_id and br.is_active)))', table_name || '_read',table_name);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_platform_admin() or (public.is_business_manager(business_id) and exists (select 1 from public.branches br where br.id=branch_id and br.business_id=business_id and br.is_active))) with check (public.is_platform_admin() or (public.is_business_manager(business_id) and exists (select 1 from public.branches br where br.id=branch_id and br.business_id=business_id and br.is_active)))', table_name || '_manage',table_name);
  end loop;
end $$;

commit;
