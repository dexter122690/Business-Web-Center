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
as $$
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
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'invoices', 'expenses', 'quotations', 'scheduled_appointments',
    'payroll_workers', 'payroll_attendance', 'payroll_vehicle_jobs',
    'payroll_job_payments', 'payroll_obligations',
    'payroll_obligation_payments', 'payroll_periods', 'payslips',
    'cash_collections', 'service_repair_orders', 'business_feedback'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'audit_' || table_name, table_name);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute procedure public.capture_business_audit()',
      'audit_' || table_name, table_name
    );
  end loop;
end $$;

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
