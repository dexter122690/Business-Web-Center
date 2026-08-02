-- Online activity history for disputes, accountability, and safe support.
-- Run after migrations 002 through 018. This only adds audit records; it does
-- not change or remove existing business data.

begin;

alter table public.audit_logs
  add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table public.audit_logs
  add column if not exists actor_name text;

create index if not exists audit_logs_business_branch_created_idx
  on public.audit_logs (business_id, branch_id, created_at desc);

/* Keep before/after snapshots in an append-only log.  The function runs as the
   database owner so normal staff cannot forge or suppress an audit entry. */
create or replace function public.capture_business_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $audit$
declare
  row_data jsonb;
  old_data jsonb;
  action_name text;
  actor_label text;
begin
  if tg_op = 'DELETE' then
    row_data := to_jsonb(old);
    old_data := row_data;
    action_name := 'deleted';
  elsif tg_op = 'INSERT' then
    row_data := to_jsonb(new);
    old_data := null;
    action_name := 'created';
  else
    row_data := to_jsonb(new);
    old_data := to_jsonb(old);
    /* Ignore automatic updated_at-only changes. */
    if (row_data - 'updated_at') = (old_data - 'updated_at') then
      return new;
    end if;
    action_name := 'updated';
  end if;

  select coalesce(nullif(full_name, ''), email, 'System') into actor_label
  from public.profiles where id = auth.uid();

  insert into public.audit_logs (
    business_id, branch_id, actor_id, actor_name, action, entity_type, entity_id, details
  ) values (
    nullif(row_data ->> 'business_id', '')::uuid,
    nullif(row_data ->> 'branch_id', '')::uuid,
    auth.uid(),
    coalesce(actor_label, 'System'),
    action_name,
    tg_table_name,
    row_data ->> 'id',
    jsonb_build_object(
      'operation', tg_op,
      'before', old_data,
      'after', case when tg_op = 'DELETE' then null else row_data end
    )
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$audit$;

drop trigger if exists audit_invoices on public.invoices;
create trigger audit_invoices after insert or update or delete on public.invoices for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_expenses on public.expenses;
create trigger audit_expenses after insert or update or delete on public.expenses for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_quotations on public.quotations;
create trigger audit_quotations after insert or update or delete on public.quotations for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_scheduled_appointments on public.scheduled_appointments;
create trigger audit_scheduled_appointments after insert or update or delete on public.scheduled_appointments for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_payroll_workers on public.payroll_workers;
create trigger audit_payroll_workers after insert or update or delete on public.payroll_workers for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_payroll_attendance on public.payroll_attendance;
create trigger audit_payroll_attendance after insert or update or delete on public.payroll_attendance for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_payroll_vehicle_jobs on public.payroll_vehicle_jobs;
create trigger audit_payroll_vehicle_jobs after insert or update or delete on public.payroll_vehicle_jobs for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_payroll_job_payments on public.payroll_job_payments;
create trigger audit_payroll_job_payments after insert or update or delete on public.payroll_job_payments for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_payroll_obligations on public.payroll_obligations;
create trigger audit_payroll_obligations after insert or update or delete on public.payroll_obligations for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_payroll_obligation_payments on public.payroll_obligation_payments;
create trigger audit_payroll_obligation_payments after insert or update or delete on public.payroll_obligation_payments for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_payroll_periods on public.payroll_periods;
create trigger audit_payroll_periods after insert or update or delete on public.payroll_periods for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_payslips on public.payslips;
create trigger audit_payslips after insert or update or delete on public.payslips for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_cash_collections on public.cash_collections;
create trigger audit_cash_collections after insert or update or delete on public.cash_collections for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_service_repair_orders on public.service_repair_orders;
create trigger audit_service_repair_orders after insert or update or delete on public.service_repair_orders for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_business_feedback on public.business_feedback;
create trigger audit_business_feedback after insert or update or delete on public.business_feedback for each row execute procedure public.capture_business_audit();

/* Activity history is available to the business owner/admin and to the platform
   administrator, but never to ordinary staff members. */
drop policy if exists audit_logs_read on public.audit_logs;
create policy audit_logs_read on public.audit_logs
for select to authenticated
using (
  public.is_platform_admin()
  or (business_id is not null and public.is_business_manager(business_id))
);

commit;
