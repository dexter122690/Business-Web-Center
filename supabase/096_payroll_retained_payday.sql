-- Atomic retained-payment receipts and versioned combined payday PDFs.
-- Disabled until an owner-reviewed branch rollout is explicitly activated.
begin;
create table if not exists public.payroll_v2_rollouts (
 business_id uuid not null references public.businesses(id),branch_id uuid not null references public.branches(id),
 version integer not null default 2,employee_id text not null,first_week date not null,
 activated_at timestamptz not null default now(),primary key(business_id,branch_id));
alter table public.payroll_v2_rollouts enable row level security;
revoke all on public.payroll_v2_rollouts from public,anon,authenticated;

create or replace function public.payroll_v2_receipt_period(s jsonb,e text,d text) returns jsonb
language plpgsql set search_path=public as $$
declare periods jsonb:='{}';p jsonb;sh jsonb;start_day date;chosen text;prev text;result jsonb;
begin
 for n in -3..3 loop
  start_day:=payroll_v2_contract_week(d)::date+n*7;
  chosen:=case when s#>>array['payrollFreshStarts',e] is not null then s#>>array['employeePayrollPaydays',e,start_day::text] else s#>>array['payrollPaydays',start_day::text] end;
  p:=jsonb_build_object('start',start_day::text,'end',(start_day+6)::text,'releaseDate',coalesce(chosen,(start_day+7)::text));
  periods:=periods||jsonb_build_object(start_day::text,p);
 end loop;
 for sh in select x from jsonb_array_elements(s->'painterTestSheets') with ordinality a(x,n) where x->>'employeeId'=e order by n loop periods:=periods||jsonb_build_object(sh#>>'{period,start}',sh->'period');end loop;
 for sh in select x from jsonb_array_elements(s->'releasedPainterSlips') x where x->>'employeeId'=e loop periods:=periods||jsonb_build_object(sh#>>'{period,start}',sh->'period');end loop;
 for p in select value from jsonb_each(periods) order by key loop
  if prev is not null and p->>'releaseDate'<=prev then raise exception 'Payroll paydays overlap or are out of order';end if;
  if result is null and p->>'releaseDate'>=d then result:=p;end if;prev:=p->>'releaseDate';
 end loop;
 if result is null or not exists(select 1 from jsonb_array_elements(s->'painterTestSheets') x where x->>'employeeId'=e and x->'period'=result)
  then raise exception 'Save the payroll table for the payment payday first';end if;
 return result;
end $$;

create or replace function public.payroll_v2_check_payday(old_state jsonb,new_state jsonb,b uuid,r uuid) returns void
language plpgsql set search_path=public as $$
declare prior jsonb:=coalesce(old_state->'retainedPaydayCopies','[]');copies jsonb:=coalesce(new_state->'retainedPaydayCopies','[]');
 receipts jsonb:=coalesce(new_state->'painterRetentionReceipts','[]');old_receipts jsonb:=coalesce(old_state->'painterRetentionReceipts','[]');
 c jsonb;p jsonb;source jsonb;base jsonb;released jsonb;refs jsonb;snap jsonb;last_copy jsonb;basis jsonb;total numeric;
 count_new integer;enabled boolean;expected_version integer;latest_id text;
begin
 select exists(select 1 from payroll_v2_rollouts x where x.business_id=b and x.branch_id=r and version=2) into enabled;
 if new_state->'payrollFreshStarts' is distinct from old_state->'payrollFreshStarts' then raise exception 'Keep the approved payroll restart settings';end if;
 if not enabled then
  if copies is distinct from prior or receipts is distinct from old_receipts then raise exception 'Combined payday workflow is not active for this branch';end if;
  perform payroll_v2_check_retention_receipts(old_state,new_state);return;
 end if;
 if jsonb_typeof(copies)<>'array' or jsonb_array_length(copies)>10000 then raise exception 'Invalid payday copies';end if;
 if exists(select 1 from jsonb_array_elements(copies) x group by x->>'id' having count(*)>1) then raise exception 'Duplicate payday copy';end if;
 for c in select * from jsonb_array_elements(prior) loop
  if not exists(select 1 from jsonb_array_elements(copies) x where x=c) then raise exception 'Previous payday copies are read-only';end if;
 end loop;
 select count(*) into count_new from jsonb_array_elements(receipts) x where not exists(select 1 from jsonb_array_elements(old_receipts) o where o=x);
 if count_new>1 then raise exception 'Confirm one retained balance at a time';end if;
 if count_new=1 then
  if new_state-array['painterRetentionReceipts','retainedPaydayCopies','period'] is distinct from old_state-array['painterRetentionReceipts','retainedPaydayCopies','period']
   then raise exception 'Save table changes separately before confirming receipt';end if;
  select x into p from jsonb_array_elements(receipts) x where not exists(select 1 from jsonb_array_elements(old_receipts) o where o=x);
  if p->>'recordedBy' is distinct from auth.uid()::text or abs(extract(epoch from ((p->>'recordedAt')::timestamptz-now())))>600
   or p->'payrollPeriod' is distinct from payroll_v2_receipt_period(new_state,p->>'employeeId',p->>'receivedOn')
   or p-array['id','employeeId','jobId','amount','receivedOn','recordedAt','recordedBy','basis','payrollPeriod']<>'{}'::jsonb
   then raise exception 'Reopen the retained-payment confirmation to use current account, date and payday';end if;
 end if;
 perform payroll_v2_check_retention_receipts(old_state,new_state,true);
 for c in select x from jsonb_array_elements(copies) x where not exists(select 1 from jsonb_array_elements(prior) o where o=x) loop
  if coalesce(c->>'id','')='' or length(c->>'id')>160 or c->'retainedPaydayCopy' is distinct from 'true'::jsonb or (c->>'savedAt')::timestamptz is null
   or exists(select 1 from jsonb_array_elements((new_state->'payslips')||(new_state->'releasedPainterSlips')) x where x->>'id'=c->>'id') then raise exception 'Invalid combined payday copy';end if;
  select x into source from jsonb_array_elements(new_state->'painterTestSheets') with ordinality a(x,n)
   where x->>'employeeId'=c->>'employeeId' and x->'period'=c->'period' order by n desc limit 1;
  if source is null or c->>'sourceId' is distinct from source->>'id' then raise exception 'Use the latest saved payday worksheet';end if;
  select x into released from jsonb_array_elements(new_state->'releasedPainterSlips') x where x->>'employeeId'=c->>'employeeId' and x->'period'=c->'period';
  base:=coalesce(released,source);
  if c-array['id','sourceId','snapshot','retentionPreviousPayday','retainedPaydayCopy','weeklyReleased','releasedCopy','version','updatedCopy','savedAt','paydayBasis','supersedesId']
   is distinct from base-array['id','sourceId','snapshot','retentionPreviousPayday','retainedPaydayCopy','weeklyReleased','releasedCopy','version','updatedCopy','savedAt','paydayBasis','supersedesId']
   then raise exception 'Keep the saved payday identity and release metadata';end if;
  select coalesce(jsonb_agg(x order by n),'[]'),coalesce(sum((x->>'amount')::numeric),0) into refs,total from jsonb_array_elements(receipts) with ordinality a(x,n)
   where x->>'employeeId'=c->>'employeeId' and x->'payrollPeriod'=c->'period';
  if jsonb_array_length(refs)=0 then raise exception 'A combined copy needs a confirmed retained payment';end if;
  snap:=c->'snapshot';
  if snap-array['previousPayments','retentionReceipts','retainedPaydayPayments','retainedPaydayTotal','paydayTotal','paydayWeeklyReleased']
    is distinct from (base->'snapshot')-array['previousPayments','retentionReceipts']
   or snap->'retainedPaydayPayments' is distinct from refs or (snap->>'retainedPaydayTotal')::numeric is distinct from total
   or (snap->>'paydayTotal')::numeric is distinct from ((base#>>'{snapshot,net}')::numeric+total)
   or snap->'paydayWeeklyReleased' is distinct from to_jsonb(released is not null)
   or c->'weeklyReleased' is distinct from to_jsonb(released is not null) or c->'releasedCopy' is distinct from to_jsonb(released is not null)
   or snap->'retentionReceipts' is distinct from (select coalesce(jsonb_agg(x order by n),'[]') from jsonb_array_elements(receipts) with ordinality a(x,n) where x->>'employeeId'=c->>'employeeId' and x->>'receivedOn'<=c#>>'{period,releaseDate}')
   then raise exception 'Combined payslip must match saved salary and count each retained receipt exactly once';end if;
  basis:=jsonb_build_object('sourceId',source->>'id','baseReleaseId',coalesce(released->>'id',''),'period',c->'period','snapshot',snap,'weeklyReleased',released is not null);
  if c->'paydayBasis' is distinct from basis then raise exception 'Invalid payday basis';end if;
  select count(*)+1 into expected_version from jsonb_array_elements(prior) x where x->>'employeeId'=c->>'employeeId' and x->'period'=c->'period';
  select x into last_copy from jsonb_array_elements(prior) with ordinality a(x,n) where x->>'employeeId'=c->>'employeeId' and x->'period'=c->'period' order by n desc limit 1;
  if (c->>'version')::integer is distinct from expected_version or c->>'supersedesId' is distinct from coalesce(last_copy->>'id',released->>'id','')
   or c->'updatedCopy' is distinct from to_jsonb(last_copy is not null or released is not null) then raise exception 'Keep the payday version chain';end if;
 end loop;
 -- Latest copy must reflect every confirmed payment and the current salary source.
 for p in select * from jsonb_array_elements(receipts) where value ? 'payrollPeriod' loop
  select x into c from jsonb_array_elements(copies) with ordinality a(x,n) where x->>'employeeId'=p->>'employeeId' and x->'period'=p->'payrollPeriod' order by n desc limit 1;
  select x into source from jsonb_array_elements(new_state->'painterTestSheets') with ordinality a(x,n) where x->>'employeeId'=p->>'employeeId' and x->'period'=p->'payrollPeriod' order by n desc limit 1;
  select x into released from jsonb_array_elements(new_state->'releasedPainterSlips') x where x->>'employeeId'=p->>'employeeId' and x->'period'=p->'payrollPeriod';
  base:=coalesce(released,source);
  select coalesce(jsonb_agg(x order by n),'[]') into refs from jsonb_array_elements(receipts) with ordinality a(x,n) where x->>'employeeId'=p->>'employeeId' and x->'payrollPeriod'=p->'payrollPeriod';
  if c is null or source is null or c#>'{snapshot,retainedPaydayPayments}' is distinct from refs or c->>'sourceId' is distinct from source->>'id'
   or c->'weeklyReleased' is distinct from to_jsonb(released is not null)
   or (c->'snapshot')-array['previousPayments','retentionReceipts','retainedPaydayPayments','retainedPaydayTotal','paydayTotal','paydayWeeklyReleased'] is distinct from (base->'snapshot')-array['previousPayments','retentionReceipts']
   then raise exception 'Save the updated payday PDF and retained payment together';end if;
 end loop;
end $$;

do $$
declare d text;p text;
begin
 d:=pg_get_functiondef('public.payroll_v2_save(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure);
 if position('payroll_v2_check_payday' in d)=0 then
  if position('payroll_v2_check_agreements' in d)=0 then raise exception 'Apply payroll update 095 first';end if;
  p:=replace(d,'perform payroll_v2_check_retention_receipts(old,next_state);','perform payroll_v2_check_payday(old,next_state,b,r);');
  p:=replace(p,$a$if not exists(select 1 from jsonb_array_elements(next_state->'releasedPainterSlips') p where p->>'id'=f->>'id')$a$,
   $a$if not exists(select 1 from jsonb_array_elements(coalesce(next_state->'retainedPaydayCopies','[]')) p where p->>'id'=f->>'id') and not exists(select 1 from jsonb_array_elements(next_state->'releasedPainterSlips') p where p->>'id'=f->>'id')$a$);
  p:=replace(p,$a$for e in select * from jsonb_array_elements(next_state->'releasedPainterSlips') loop$a$,
   $a$for e in select * from jsonb_array_elements((next_state->'releasedPainterSlips')||coalesce(next_state->'retainedPaydayCopies','[]')) loop$a$);
  if p=d then raise exception 'Unexpected payroll save definition';end if;execute p;
 end if;
 d:=pg_get_functiondef('public.payroll_v2_check_contract_events(jsonb,jsonb,text)'::regprocedure);
 p:=replace(d,$a$expected-'period' is distinct from new_state-'period'$a$,$a$expected-'period'-'retainedPaydayCopies' is distinct from new_state-'period'-'retainedPaydayCopies'$a$);
 if p<>d then execute p;end if;
 d:=pg_get_functiondef('public.payroll_v2_load(uuid,uuid)'::regprocedure);
 if position('payrollWorkflowVersion' in d)=0 then
  p:=replace(d,$a$return jsonb_build_object('state',data,$a$,$a$return jsonb_build_object('payrollWorkflowVersion',case when exists(select 1 from payroll_v2_rollouts x where x.business_id=b and x.branch_id=r and version=2) then 2 else 1 end,'state',data,$a$);
  if p=d then raise exception 'Unexpected payroll load definition';end if;execute p;
 end if;
 d:=pg_get_functiondef('public.payroll_v2_receive_retention(uuid,uuid,bigint,text,text,date,numeric,date)'::regprocedure);
 if position('payroll_v2_rollouts' in d)=0 then
  p:=replace(d,'perform pg_advisory_xact_lock',$a$if exists(select 1 from payroll_v2_rollouts x where x.business_id=b and x.branch_id=r and version=2) then raise exception 'Reload the updated payroll to confirm receipt and save its payday PDF together';end if;
 perform pg_advisory_xact_lock$a$);execute p;
 end if;
end $$;
revoke all on function public.payroll_v2_receipt_period(jsonb,text,text),public.payroll_v2_check_payday(jsonb,jsonb,uuid,uuid) from public,anon,authenticated;
commit;
