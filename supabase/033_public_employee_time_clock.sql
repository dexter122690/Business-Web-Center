-- Branch-specific public employee time clock.
-- The public link exposes only the active workers for its own branch and can
-- record a Time In or Time Out. It cannot read payroll, invoices, or another branch.

begin;

create table if not exists public.branch_time_clock_links (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  public_token uuid not null unique default gen_random_uuid(),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branch_time_clock_links_business_branch_key unique (business_id, branch_id)
);

drop trigger if exists set_branch_time_clock_links_updated_at on public.branch_time_clock_links;
create trigger set_branch_time_clock_links_updated_at before update on public.branch_time_clock_links
for each row execute procedure public.set_updated_at();

alter table public.branch_time_clock_links enable row level security;

drop policy if exists branch_time_clock_links_read on public.branch_time_clock_links;
create policy branch_time_clock_links_read on public.branch_time_clock_links for select to authenticated
using (public.is_platform_admin() or public.is_business_member(business_id));

drop policy if exists branch_time_clock_links_manage on public.branch_time_clock_links;
create policy branch_time_clock_links_manage on public.branch_time_clock_links for all to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id))
with check (public.is_platform_admin() or public.is_business_manager(business_id));

create or replace function public.get_public_time_clock_workers(p_token uuid)
returns table(employee_code text, full_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_business uuid;
  target_branch uuid;
begin
  select link.business_id, link.branch_id into target_business, target_branch
  from public.branch_time_clock_links link
  join public.businesses business on business.id = link.business_id
  join public.branches branch on branch.id = link.branch_id and branch.business_id = link.business_id
  where link.public_token = p_token
    and link.enabled = true
    and business.status = 'active'
    and branch.is_active = true;

  if target_business is null then
    raise exception 'This employee time clock link is no longer active.';
  end if;

  return query
    select worker.employee_code, worker.full_name
    from public.payroll_workers worker
    where worker.business_id = target_business
      and worker.branch_id = target_branch
      and worker.is_active = true
    order by worker.full_name;
end;
$$;

create or replace function public.submit_public_time_clock_punch(
  p_token uuid,
  p_employee_code text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_business uuid;
  target_branch uuid;
  target_worker public.payroll_workers%rowtype;
  existing_record public.payroll_attendance%rowtype;
  local_stamp timestamp;
  attendance_id uuid;
begin
  select link.business_id, link.branch_id into target_business, target_branch
  from public.branch_time_clock_links link
  join public.businesses business on business.id = link.business_id
  join public.branches branch on branch.id = link.branch_id and branch.business_id = link.business_id
  where link.public_token = p_token
    and link.enabled = true
    and business.status = 'active'
    and branch.is_active = true;

  if target_business is null then
    raise exception 'This employee time clock link is no longer active.';
  end if;
  if p_action not in ('in', 'out') then
    raise exception 'Choose Time In or Time Out.';
  end if;

  select * into target_worker
  from public.payroll_workers worker
  where worker.business_id = target_business
    and worker.branch_id = target_branch
    and worker.is_active = true
    and lower(trim(worker.employee_code)) = lower(trim(coalesce(p_employee_code, '')));

  if target_worker.id is null then
    raise exception 'Employee ID is not active for this branch.';
  end if;

  -- The server records Philippine local time so the device cannot choose a date.
  local_stamp := now() at time zone 'Asia/Manila';

  select * into existing_record
  from public.payroll_attendance attendance
  where attendance.worker_id = target_worker.id
    and attendance.work_date = local_stamp::date
  for update;

  if p_action = 'in' then
    if existing_record.id is not null and existing_record.time_in is not null then
      raise exception 'Time In was already recorded today at %.', to_char(existing_record.time_in, 'HH24:MI');
    end if;
    if existing_record.id is null then
      insert into public.payroll_attendance (
        business_id, branch_id, worker_id, work_date, time_in,
        attendance_approved, overtime_approved, recorded_by
      ) values (
        target_business, target_branch, target_worker.id, local_stamp::date, local_stamp::time,
        false, false, null
      ) returning id into attendance_id;
    else
      update public.payroll_attendance
      set time_in = local_stamp::time,
          attendance_approved = false,
          updated_at = now()
      where id = existing_record.id
      returning id into attendance_id;
    end if;
  else
    if existing_record.id is null or existing_record.time_in is null then
      raise exception 'No Time In is on record today. Time In must be captured first.';
    end if;
    if existing_record.time_out is not null then
      raise exception 'Time Out was already recorded today at %.', to_char(existing_record.time_out, 'HH24:MI');
    end if;
    update public.payroll_attendance
    set time_out = local_stamp::time,
        attendance_approved = false,
        updated_at = now()
    where id = existing_record.id
    returning id into attendance_id;
  end if;

  return jsonb_build_object(
    'attendance_id', attendance_id,
    'employee_code', target_worker.employee_code,
    'employee_name', target_worker.full_name,
    'action', p_action,
    'punched_at', local_stamp
  );
end;
$$;

revoke all on function public.get_public_time_clock_workers(uuid) from public;
grant execute on function public.get_public_time_clock_workers(uuid) to anon, authenticated;
revoke all on function public.submit_public_time_clock_punch(uuid,text,text) from public;
grant execute on function public.submit_public_time_clock_punch(uuid,text,text) to anon, authenticated;

commit;
