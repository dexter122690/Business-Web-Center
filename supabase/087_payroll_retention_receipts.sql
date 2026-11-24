-- 45-day availability and separately confirmed full-balance receipts.
-- No existing amounts, employees, worksheets, PDFs, or access grants are changed.
begin;
create or replace function public.payroll_v2_retention_basis(s jsonb,employee_id text,job_id text) returns jsonb
language plpgsql set search_path=public as $$
declare sheets jsonb; rw jsonb; j jsonb; paid jsonb; amount numeric; released date;
begin
 select coalesce(jsonb_agg(x order by x#>>'{period,start}'),'[]') into sheets from (
  select distinct on (x#>>'{period,start}',x#>>'{period,end}') x
  from jsonb_array_elements(s->'painterTestSheets') with ordinality a(x,n)
  where x->>'employeeId'=employee_id
  order by x#>>'{period,start}',x#>>'{period,end}',n desc) q;
 select v into rw from jsonb_array_elements(sheets) sh cross join lateral jsonb_array_elements(sh#>'{snapshot,rows}') v
  where v#>>'{job,id}'=job_id order by sh#>>'{period,start}' desc limit 1;
 j:=rw->'job';released:=coalesce(nullif(j->>'unitReleasedOn',''),nullif(j->>'releasedOn',''))::date;
 if rw is null or j->>'employeeId' is distinct from employee_id or j->'contractPending'='true'::jsonb
  or jsonb_typeof(j->'contract') is distinct from 'number' or released is null
  or not (coalesce(j->>'retentionStatus'='retained',false) or coalesce((j->>'closed')::boolean,false))
 then raise exception 'Confirm the agreed labor and unit release date first';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(s->'payments','[]')||coalesce(s->'releases','[]')) p where p->>'jobId'=job_id)
 then raise exception 'Review legacy payments before confirming receipt';end if;
 select coalesce(jsonb_agg(jsonb_build_object('start',sh#>>'{period,start}','end',sh#>>'{period,end}','amount',v->'weekly') order by sh#>>'{period,start}'),'[]') into paid
  from jsonb_array_elements(sheets) sh cross join lateral jsonb_array_elements(sh#>'{snapshot,rows}') v
  where v#>>'{job,id}'=job_id and (v->>'weekly')::numeric<>0;
 amount:=round((j->>'contract')::numeric-coalesce((j->>'priorSettlement')::numeric,0)-(select coalesce(sum((p->>'amount')::numeric),0) from jsonb_array_elements(paid) p),2);
 if amount is null or amount<=0 or amount>999999999 or round((rw->>'remaining')::numeric,2) is distinct from amount
 then raise exception 'Review the saved unit balance before confirming receipt';end if;
 return jsonb_build_object('employeeId',employee_id,'jobId',job_id,'unit',j->>'unit','plate',coalesce(j->>'plate',''),'contract',j->'contract',
  'priorSettlement',coalesce((j->>'priorSettlement')::numeric,0),'unitReleasedOn',released::text,'dueOn',(released+45)::text,'amount',amount,'payments',paid);
end $$;

create or replace function public.payroll_v2_check_retention_receipts(old_state jsonb,new_state jsonb,allow_new boolean default false) returns void
language plpgsql set search_path=public as $$
declare receipts jsonb:=coalesce(new_state->'painterRetentionReceipts','[]'); p jsonb; basis jsonb; sh jsonb; ref jsonb;
begin
 if jsonb_typeof(receipts)<>'array' then raise exception 'Invalid retained-balance receipts';end if;
 if not allow_new and receipts is distinct from coalesce(old_state->'painterRetentionReceipts','[]')
 then raise exception 'Use the received-balance confirmation action; receipt history is locked';end if;
 if exists(select 1 from jsonb_array_elements(receipts) x group by x->>'employeeId',x->>'jobId' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(receipts) x group by x->>'id' having count(*)>1)
 then raise exception 'A remaining balance can only be received once';end if;
 for p in select * from jsonb_array_elements(coalesce(old_state->'painterRetentionReceipts','[]')) loop
  if not exists(select 1 from jsonb_array_elements(receipts) x where x=p) then raise exception 'Keep the original received-balance history';end if;
 end loop;
 for p in select * from jsonb_array_elements(receipts) loop
  basis:=payroll_v2_retention_basis(new_state,p->>'employeeId',p->>'jobId');
  if p->'basis' is distinct from basis or p->'amount' is distinct from basis->'amount'
   or nullif(p->>'id','') is null or (p->>'recordedBy')::uuid is null or (p->>'recordedAt')::timestamptz is null
   or (p->>'receivedOn')::date is null or (p->>'receivedOn')::date<(basis->>'dueOn')::date
   or (p->>'receivedOn')::date>(now() at time zone 'Asia/Manila')::date
   or exists(select 1 from jsonb_array_elements(basis->'payments') x where x->>'start'>p->>'receivedOn')
  then raise exception 'Received balance is locked; its dates and saved payment basis must remain unchanged';end if;
 end loop;
 for sh in select * from jsonb_array_elements(new_state->'releasedPainterSlips') loop
  if sh#>'{snapshot,retentionReceipts}' is not null and jsonb_typeof(sh#>'{snapshot,retentionReceipts}')<>'array' then raise exception 'Invalid receipt references';end if;
  for ref in select * from jsonb_array_elements(coalesce(sh#>'{snapshot,retentionReceipts}','[]')) loop
   if not exists(select 1 from jsonb_array_elements(receipts) x where x=ref)
    or ref->>'employeeId' is distinct from sh->>'employeeId' or ref->>'receivedOn'>sh#>>'{period,releaseDate}'
    or not exists(select 1 from jsonb_array_elements(sh#>'{snapshot,rows}') x where x#>>'{job,id}'=ref->>'jobId')
   then raise exception 'Invalid retained-balance receipt reference';end if;
  end loop;
 end loop;
end $$;

create or replace function public.payroll_v2_receive_retention(b uuid,r uuid,expected_revision bigint,employee_id text,job_id text,received_on date,expected_amount numeric,expected_release_date date) returns jsonb
language plpgsql security definer set search_path=public as $$
declare w payroll_v2_workspaces%rowtype; basis jsonb; receipt jsonb; data jsonb; existing jsonb; day date:=(now() at time zone 'Asia/Manila')::date;
begin
 if payroll_v2_role(b,r) not in ('owner','edit') then raise exception 'Payroll edit access is required for this branch' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(b::text||r::text,0));
 select * into w from payroll_v2_workspaces where business_id=b and branch_id=r for update;
 if w.state is null then raise exception 'Save the unit worksheet first';end if;
 select x into existing from jsonb_array_elements(coalesce(w.state->'painterRetentionReceipts','[]')) x where x->>'employeeId'=employee_id and x->>'jobId'=job_id;
 if existing is not null then
  if (existing->>'receivedOn')::date=received_on and (existing->>'amount')::numeric=expected_amount and (existing#>>'{basis,unitReleasedOn}')::date=expected_release_date then return payroll_v2_load(b,r);end if;
  raise exception 'This remaining balance is already recorded as received';
 end if;
 if expected_revision is null or w.revision<>expected_revision then raise exception 'Another user saved changes. Reload payroll before confirming receipt.' using errcode='40001';end if;
 if not exists(select 1 from jsonb_array_elements(w.state->'employees') e where e->>'id'=employee_id and e->>'type'='contract') then raise exception 'Choose a contract employee in this branch';end if;
 basis:=payroll_v2_retention_basis(w.state,employee_id,job_id);
 if received_on is null or received_on<(basis->>'dueOn')::date or received_on>day then raise exception 'Receipt date must be on or after the 45-day due date and not later than today';end if;
 if (basis->>'amount')::numeric is distinct from expected_amount or (basis->>'unitReleasedOn')::date is distinct from expected_release_date then raise exception 'The saved balance or release date changed. Reload payroll first.';end if;
 receipt:=jsonb_build_object('id',gen_random_uuid()::text,'employeeId',employee_id,'jobId',job_id,'amount',basis->'amount','receivedOn',received_on::text,'recordedAt',now(),'recordedBy',auth.uid(),'basis',basis);
 data:=jsonb_set(w.state,'{painterRetentionReceipts}',coalesce(w.state->'painterRetentionReceipts','[]')||jsonb_build_array(receipt));
 perform payroll_v2_validate(data);
 perform payroll_v2_check_retention_receipts(w.state,data,true);
 update payroll_v2_workspaces set state=data,revision=w.revision+1,updated_at=now(),updated_by=auth.uid() where business_id=b and branch_id=r;
 insert into payroll_v2_events(business_id,branch_id,actor_id,action,details) values(b,r,auth.uid(),'retention_received',jsonb_build_object('receipt',receipt,'revision',w.revision+1));
 return payroll_v2_load(b,r);
end $$;

do $patch$
declare definition text; patched text;
begin
 definition:=pg_get_functiondef('public.payroll_v2_save(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure);
 if position('payroll_v2_check_unit_release_flow(next_state)' in definition)=0 then raise exception 'Apply payroll update 086 first';end if;
 if position('payroll_v2_check_retention_receipts(old,next_state)' in definition)=0 then
  patched:=replace(definition,'perform payroll_v2_validate(next_state);',E'perform payroll_v2_validate(next_state);\n perform payroll_v2_check_retention_receipts(old,next_state);');
  if patched=definition then raise exception 'Unexpected payroll save definition; nothing changed';end if;
  execute patched;
 end if;
 definition:=pg_get_functiondef('public.payroll_v2_validate(jsonb)'::regprocedure);
 if position($needle$-'retentionReceipts'$needle$ in definition)=0 then
  patched:=replace(definition,$old$((sh->'snapshot')-'previousPayments')<>(e-'previousPayments')$old$,$new$((sh->'snapshot')-'previousPayments'-'retentionReceipts')<>(e-'previousPayments'-'retentionReceipts')$new$);
  if patched=definition then raise exception 'Unexpected payroll snapshot validator; nothing changed';end if;
  execute patched;
 end if;
end $patch$;
revoke all on function public.payroll_v2_retention_basis(jsonb,text,text),public.payroll_v2_check_retention_receipts(jsonb,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.payroll_v2_receive_retention(uuid,uuid,bigint,text,text,date,numeric,date) from public,anon;
grant execute on function public.payroll_v2_receive_retention(uuid,uuid,bigint,text,text,date,numeric,date) to authenticated;
commit;
