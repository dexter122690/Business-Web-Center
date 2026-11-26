-- Operator-only, revision-checked, recoverable employee restart. Installs tools only.
begin;
create table if not exists public.payroll_v2_restart_archives (
 id uuid primary key default gen_random_uuid(),business_id uuid not null,branch_id uuid not null,employee_id text not null,
 before_revision bigint not null,after_revision bigint not null,before_state jsonb not null,after_state jsonb not null,
 first_week date not null,reason text not null,created_at timestamptz not null default now(),restored_at timestamptz);
alter table public.payroll_v2_restart_archives enable row level security;
revoke all on public.payroll_v2_restart_archives from public,anon,authenticated;
alter table public.payroll_v2_history_imports add column if not exists cancelled_at timestamptz;
do $$
declare d text;p text;
begin
 d:=pg_get_functiondef('public.payroll_v2_apply_reviewed_history(uuid,uuid)'::regprocedure);
 if position('cancelled_at' in d)=0 then p:=replace(d,'and applied_at is null order by','and applied_at is null and cancelled_at is null order by');if p=d then raise exception 'Unexpected history-import definition';end if;execute p;end if;
end $$;

create or replace function public.payroll_v2_restart_employee(b uuid,r uuid,e text,expected_name text,expected_revision bigint,expected_hash text,first_week date,reason text) returns jsonb
language plpgsql set search_path=public as $$
declare w payroll_v2_workspaces%rowtype;data jsonb;job_ids jsonb;slip_ids jsonb;k text;archive_id uuid;person jsonb;
begin
 if first_week is null or extract(dow from first_week)<>6 or length(btrim(reason))<10 then raise exception 'Review the restart date and reason';end if;
 perform pg_advisory_xact_lock(hashtextextended(b::text||r::text,0));
 select * into w from payroll_v2_workspaces where business_id=b and branch_id=r for update;
 if w.revision is distinct from expected_revision or md5(w.state::text) is distinct from expected_hash then raise exception 'Workspace changed. Export a fresh backup and review before restarting';end if;
 select x into person from jsonb_array_elements(w.state->'employees') x where x->>'id'=e;
 if person->>'name' is distinct from expected_name or person->>'type' is distinct from 'contract' then raise exception 'Employee identity does not match the approved restart';end if;
 select coalesce(jsonb_agg(distinct id),'[]') into job_ids from (
  select x->>'id' id from jsonb_array_elements(w.state->'jobs') x where x->>'employeeId'=e
  union select x#>>'{job,id}' from jsonb_array_elements(w.state->'painterTestSheets') sh cross join lateral jsonb_array_elements(sh#>'{snapshot,rows}') x where sh->>'employeeId'=e) j;
 select coalesce(jsonb_agg(x->>'id'),'[]') into slip_ids from jsonb_array_elements(w.state->'payslips') x where x->>'employeeId'=e;
 data:=w.state;
 foreach k in array array['jobs','plans','payments','releases','advances','attendance','payslips','legacyReleases','painterTestSheets','releasedPainterSlips','painterRetentionReceipts','painterContractEvents','retainedPaydayCopies'] loop
  if data ? k then data:=jsonb_set(data,array[k],(select coalesce(jsonb_agg(x order by n),'[]') from jsonb_array_elements(data->k) with ordinality a(x,n)
   where coalesce(x->>'employeeId','')<>e and coalesce(x#>>'{snapshot,employee,id}','')<>e and not(job_ids ? coalesce(x->>'jobId',''))));end if;
 end loop;
 data:=jsonb_set(data,'{slipReleases}',(select coalesce(jsonb_agg(x order by n),'[]') from jsonb_array_elements(data->'slipReleases') with ordinality a(x,n) where not(slip_ids ? coalesce(x->>'slipId',''))));
 data:=jsonb_set(data,'{payrollFreshStarts}',coalesce(data->'payrollFreshStarts','{}')||jsonb_build_object(e,first_week::text));
 data:=jsonb_set(data,'{employeePayrollPaydays}',coalesce(data->'employeePayrollPaydays','{}')||jsonb_build_object(e,'{}'::jsonb));
 data:=jsonb_set(data,'{period}',jsonb_build_object('start',first_week::text,'end',(first_week+6)::text,'releaseDate',(first_week+7)::text));
 perform payroll_v2_validate(data);
 if data->'employees' is distinct from w.state->'employees' or data->'rules' is distinct from w.state->'rules' or data->'payrollPaydays' is distinct from w.state->'payrollPaydays' then raise exception 'Protected employee or shared settings changed';end if;
 insert into payroll_v2_restart_archives(business_id,branch_id,employee_id,before_revision,after_revision,before_state,after_state,first_week,reason)
  values(b,r,e,w.revision,w.revision+1,w.state,data,first_week,reason) returning id into archive_id;
 update payroll_v2_history_imports set cancelled_at=now() where business_id=b and branch_id=r and employee_id=e and applied_at is null and cancelled_at is null;
 insert into payroll_v2_rollouts(business_id,branch_id,employee_id,first_week) values(b,r,e,first_week)
  on conflict(business_id,branch_id) do update set version=2,employee_id=e,first_week=excluded.first_week;
 update payroll_v2_workspaces set state=data,revision=w.revision+1,updated_at=now() where business_id=b and branch_id=r;
 insert into payroll_v2_events(business_id,branch_id,actor_id,action,details) values(b,r,null,'employee_restart',jsonb_build_object('archive_id',archive_id,'employee_id',e,'reason',reason,'revision',w.revision+1));
 return jsonb_build_object('archive_id',archive_id,'revision',w.revision+1,'state_hash',md5(data::text));
end $$;

create or replace function public.payroll_v2_check_restart_ids(s jsonb,b uuid,r uuid) returns void
language plpgsql set search_path=public as $$
begin
 if exists(select 1 from payroll_v2_restart_archives a cross join lateral payroll_v2_ledger_rows(a.before_state) old
  join payroll_v2_ledger_rows(s) n on n.employee=old.employee and n.job_id=old.job_id
  where a.business_id=b and a.branch_id=r and a.restored_at is null and old.employee=a.employee_id)
  then raise exception 'This unit belongs to the archived pre-restart payroll. Enter it as a new unit; do not restore old payroll copies';end if;
end $$;
do $$
declare d text;p text;
begin
 d:=pg_get_functiondef('public.payroll_v2_save(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure);
 if position('payroll_v2_check_restart_ids' in d)=0 then
  p:=replace(d,'perform payroll_v2_check_payday(old,next_state,b,r);',E'perform payroll_v2_check_payday(old,next_state,b,r);\n perform payroll_v2_check_restart_ids(next_state,b,r);');
  if p=d then raise exception 'Apply payroll update 096 first';end if;execute p;
 end if;
end $$;
-- Recovery is operator-only and refuses to overwrite any newly encoded payroll.
create or replace function public.payroll_v2_restore_restart(archive_id uuid) returns void
language plpgsql set search_path=public as $$
declare a payroll_v2_restart_archives%rowtype;w payroll_v2_workspaces%rowtype;
begin
 select * into strict a from payroll_v2_restart_archives where id=archive_id and restored_at is null;
 perform pg_advisory_xact_lock(hashtextextended(a.business_id::text||a.branch_id::text,0));
 select * into w from payroll_v2_workspaces where business_id=a.business_id and branch_id=a.branch_id for update;
 if w.revision<>a.after_revision or w.state is distinct from a.after_state then raise exception 'New payroll has been saved. Review and merge recovery; do not overwrite it';end if;
 update payroll_v2_workspaces set state=a.before_state,revision=w.revision+1,updated_at=now() where business_id=a.business_id and branch_id=a.branch_id;
 update payroll_v2_restart_archives set restored_at=now() where id=archive_id;
 update payroll_v2_rollouts set version=1 where business_id=a.business_id and branch_id=a.branch_id;
 insert into payroll_v2_events(business_id,branch_id,action,details) values(a.business_id,a.branch_id,'restart_restored',jsonb_build_object('archive_id',archive_id));
end $$;
revoke all on function public.payroll_v2_restart_employee(uuid,uuid,text,text,bigint,text,date,text),public.payroll_v2_check_restart_ids(jsonb,uuid,uuid),public.payroll_v2_restore_restart(uuid) from public,anon,authenticated;
commit;
