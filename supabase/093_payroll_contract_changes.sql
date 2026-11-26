-- Dated agreements, append-only corrections and explicit separate transactions.
-- No existing records, amounts, files or access grants are modified by this update.
begin;
create or replace function public.payroll_v2_contract_week(d text) returns text
language sql immutable set search_path=public as $$ select to_char(d::date-((extract(dow from d::date)::integer+1)%7),'YYYY-MM-DD'); $$;

create or replace function public.payroll_v2_contract_baseline(s jsonb,e text,j text) returns numeric
language sql immutable set search_path=public as $$
 select case when exists(select 1 from jsonb_array_elements(coalesce(s->'painterContractEvents','[]')) x where x->>'employeeId'=e and x->>'jobId'=j)
 then (select (x->>'baselineAmount')::numeric from jsonb_array_elements(s->'painterContractEvents') with ordinality a(x,n) where x->>'employeeId'=e and x->>'jobId'=j order by n limit 1)
 else (select (rw#>>'{job,contract}')::numeric from payroll_v2_ledger_rows(s) where employee=e and job_id=j and coalesce(rw#>'{job,contractPending}','false')<>'true'::jsonb order by week desc limit 1) end;
$$;
create or replace function public.payroll_v2_contract_at(s jsonb,e text,j text,through_day text,fallback numeric) returns numeric
language plpgsql immutable set search_path=public as $$
declare x jsonb; amount numeric; first_event boolean:=true;
begin
 for x in select v from jsonb_array_elements(coalesce(s->'painterContractEvents','[]')) with ordinality a(v,n) where v->>'employeeId'=e and v->>'jobId'=j order by n loop
  if first_event then
   if through_day<payroll_v2_contract_week(x->>'effectiveOn') then return fallback;end if;
   amount:=(x->>'baselineAmount')::numeric;first_event:=false;
  end if;
  if payroll_v2_contract_week(x->>'effectiveOn')<=through_day then amount:=case when x->>'kind'='addition' then amount+(x->>'amount')::numeric else (x->>'amount')::numeric end;end if;
 end loop;
 return case when first_event then fallback else amount end;
end $$;

create or replace function public.payroll_v2_apply_contract_event(s jsonb,ev jsonb) returns jsonb
language plpgsql set search_path=public as $$
declare e text:=ev->>'employeeId';j text:=ev->>'jobId';start_week text;before_amount numeric;after_amount numeric;baseline numeric;paid numeric;price numeric;prior numeric;release_day text;last_date text;
 result jsonb;sh jsonb;rw jsonb;job jsonb;new_rows jsonb;new_sheets jsonb:='[]';new_jobs jsonb;latest_id text;changed boolean;
begin
 if jsonb_typeof(ev) is distinct from 'object' or coalesce(ev->>'kind','') not in ('addition','correction','confirmation') or coalesce(ev->>'id','')='' or length(ev->>'id')>160
  or jsonb_typeof(ev->'amount') is distinct from 'number' or jsonb_typeof(ev->'description') is distinct from 'string' or jsonb_typeof(ev->'reason') is distinct from 'string'
  or coalesce(ev->>'effectiveOn','')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(ev->>'recordedAt','')='' or not(ev?'baselineAmount')
  or ev-'id'-'employeeId'-'jobId'-'kind'-'amount'-'effectiveOn'-'description'-'reason'-'baselineAmount'-'recordedAt'<>'{}'::jsonb
 then raise exception 'Invalid contract change';end if;
 if (ev->>'amount')::numeric not between 0 and 999999999 or (ev->>'amount')::numeric<>round((ev->>'amount')::numeric,2)
  or length(btrim(ev->>'description')) not between 3 and 1000 or length(btrim(ev->>'reason')) not between 3 and 1000
  or (ev->>'effectiveOn')::date>(now() at time zone 'Asia/Manila')::date or not isfinite((ev->>'recordedAt')::timestamptz)
 then raise exception 'Enter a valid contract amount, description, reason and effective date (not in the future)';end if;
 start_week:=payroll_v2_contract_week(ev->>'effectiveOn');
 if not exists(select 1 from payroll_v2_ledger_rows(s) where employee=e and job_id=j) then raise exception 'Save the unit first, then record its contract change';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(s->'painterContractEvents','[]')) x where x->>'id'=ev->>'id') then raise exception 'This contract change was already recorded';end if;
 baseline:=payroll_v2_contract_baseline(s,e,j);
 if (ev->'baselineAmount') is distinct from coalesce(to_jsonb(baseline),'null'::jsonb) then raise exception 'Agreed labor changed; reload and review the latest amount';end if;
 if start_week<(select min(week) from payroll_v2_ledger_rows(s) where employee=e and job_id=j) then raise exception 'Use a date on or after the first saved payroll week';end if;
 select max(x->>'effectiveOn') into last_date from jsonb_array_elements(coalesce(s->'painterContractEvents','[]')) x where x->>'employeeId'=e and x->>'jobId'=j;
 if ev->>'effectiveOn'<last_date then raise exception 'Use a date on or after the latest contract change: %',last_date;end if;
 before_amount:=payroll_v2_contract_at(s,e,j,'9999-12-31',baseline);
 if ev->>'kind'='addition' and (before_amount is null or (ev->>'amount')::numeric<=0) then raise exception 'Confirm agreed labor first, then enter a positive additional price';end if;
 if ev->>'kind'='confirmation' and before_amount is not null then raise exception 'Agreed labor is already confirmed; use Correct agreed labor';end if;
 if ev->>'kind'='correction' and before_amount is null then raise exception 'Use Confirm agreed labor for an unpriced job';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(s->'painterRetentionReceipts','[]')) p where p->>'employeeId'=e and p->>'jobId'=j) then raise exception 'Received retained balances and their contract history are locked';end if;
 select lr.rw->'job' into job from payroll_v2_ledger_rows(s) lr where employee=e and job_id=j order by week desc limit 1;
 release_day:=coalesce(nullif(job->>'unitReleasedOn',''),nullif(job->>'releasedOn',''));
 if ev->>'kind'='addition' and ev->>'effectiveOn'>release_day then raise exception 'Unit was released on %. Use a separate transaction for later work.',release_day;end if;
 result:=jsonb_set(s,'{painterContractEvents}',coalesce(s->'painterContractEvents','[]')||jsonb_build_array(ev));
 after_amount:=payroll_v2_contract_at(result,e,j,'9999-12-31',baseline);
 select coalesce(sum(amount),0)+coalesce((job->>'priorSettlement')::numeric,0) into paid from payroll_v2_ledger_payments(s,e,j);
 if after_amount>999999999 or after_amount<paid then raise exception 'Agreed labor cannot be below % already recorded across all payroll dates',paid;end if;
 for sh in select * from jsonb_array_elements(s->'painterTestSheets') loop
  changed:=false;new_rows:='[]';
  select x->>'id' into latest_id from jsonb_array_elements(s->'painterTestSheets') with ordinality a(x,n) where x->>'employeeId'=e and x#>>'{period,start}'=sh#>>'{period,start}' and x#>>'{period,end}'=sh#>>'{period,end}' order by n desc limit 1;
  for rw in select * from jsonb_array_elements(sh#>'{snapshot,rows}') loop
   if sh->>'employeeId'=e and sh->>'id'=latest_id and rw#>>'{job,id}'=j and sh#>>'{period,start}'>=start_week then
    if exists(select 1 from jsonb_array_elements(coalesce(s->'releasedPainterSlips','[]')) x where x->>'sourceId'=sh->>'id' or (x->>'employeeId'=e and x#>>'{period,start}'=sh#>>'{period,start}' and x#>>'{period,end}'=sh#>>'{period,end}')) then raise exception 'Payroll % has a released payslip. Use a later open effective week; the original stays locked.',sh#>>'{period,start}';end if;
    price:=payroll_v2_contract_at(result,e,j,sh#>>'{period,end}',(rw#>>'{job,contract}')::numeric);
    select coalesce(sum(amount),0)+coalesce((rw#>>'{job,priorSettlement}')::numeric,0) into prior from payroll_v2_ledger_payments(s,e,j) where end_date<sh#>>'{period,start}';
    if price<prior+(rw->>'weekly')::numeric then raise exception 'Corrected agreement is below payments recorded by %',sh#>>'{period,end}';end if;
    rw:=jsonb_set(rw,'{job}',jsonb_set(rw->'job','{contract}',to_jsonb(price))-'contractPending')-'previousRecorded';
    rw:=jsonb_set(jsonb_set(rw,'{opening}',to_jsonb(price-prior)),'{remaining}',to_jsonb(price-prior-(rw->>'weekly')::numeric));changed:=true;
   end if;
   new_rows:=new_rows||jsonb_build_array(rw);
  end loop;
  if changed then select coalesce(jsonb_agg(x->'job'),'[]') into new_jobs from jsonb_array_elements(new_rows) x;sh:=jsonb_set(jsonb_set(sh,'{snapshot,rows}',new_rows),'{snapshot,jobs}',new_jobs);end if;
  new_sheets:=new_sheets||jsonb_build_array(sh);
 end loop;
 return jsonb_set(result,'{painterTestSheets}',new_sheets);
end $$;

create or replace function public.payroll_v2_check_contract_events(old_state jsonb,new_state jsonb,access_role text) returns void
language plpgsql set search_path=public as $$
declare before_list jsonb:=coalesce(old_state->'painterContractEvents','[]');after_list jsonb:=coalesce(new_state->'painterContractEvents','[]');n integer;i integer;ev jsonb;expected jsonb;
begin
 if jsonb_typeof(after_list) is distinct from 'array' then raise exception 'Invalid contract history';end if;
 if exists(select 1 from payroll_v2_ledger_rows(new_state) n join payroll_v2_ledger_rows(old_state) o on n.employee=o.employee and n.job_id=o.job_id where coalesce(n.rw#>>'{job,transactionRef}','')<>coalesce(o.rw#>>'{job,transactionRef}','') or coalesce(n.rw#>>'{job,separateJobReason}','')<>coalesce(o.rw#>>'{job,separateJobReason}','')) then raise exception 'Keep the saved transaction reference and reason';end if;
 n:=jsonb_array_length(before_list);
 if jsonb_array_length(after_list)<n or jsonb_array_length(after_list)>n+1 then raise exception 'Keep contract history permanent and save one change at a time';end if;
 for i in 0..n-1 loop if before_list->i is distinct from after_list->i then raise exception 'Contract history is permanent. Record a new correction instead.';end if;end loop;
 if jsonb_array_length(after_list)=n+1 then
  ev:=after_list->n;
  if access_role not in ('owner','edit') or (ev->>'kind'='correction' and access_role<>'owner') then raise exception 'Only the owner can correct agreed labor' using errcode='42501';end if;
  expected:=payroll_v2_apply_contract_event(old_state,ev);
  if expected-'period' is distinct from new_state-'period' then raise exception 'Save table changes separately from the contract change. Payments and released copies must remain unchanged.';end if;
 end if;
end $$;

create or replace function public.payroll_v2_separate_job_allowed(s jsonb,e text,j jsonb) returns boolean
language sql immutable set search_path=public as $$
 with others as (select distinct on(job_id) rw->'job' x from payroll_v2_ledger_rows(s) where employee=e and job_id<>j->>'id' order by job_id,week desc),
 matches as (select x from others where upper(btrim(x->>'invoice'))=upper(btrim(j->>'invoice')) and upper(btrim(x->>'plate'))=upper(btrim(j->>'plate')))
 select coalesce(length(btrim(j->>'transactionRef')) between 1 and 80 and length(btrim(j->>'separateJobReason')) between 5 and 1000
  and exists(select 1 from matches) and not exists(select 1 from matches where upper(btrim(x->>'transactionRef'))=upper(btrim(j->>'transactionRef')) or not(coalesce(x->>'retentionStatus','')='retained' or coalesce(x->'closed','false')='true'::jsonb) or coalesce(nullif(x->>'unitReleasedOn',''),nullif(x->>'releasedOn',''),'9999-12-31')>s#>>'{period,end}'),false);
$$;

-- Extend the existing cross-date guard; retain its payment, balance, receipt and release checks.
do $patch$
declare definition text;patched text;
begin
 definition:=pg_get_functiondef('public.payroll_v2_retention_basis(jsonb,text,text)'::regprocedure);
 if position('payroll_v2_contract_at' in definition)=0 then
  patched:=replace(definition,'amount:=round((j->>''contract'')::numeric',E'if payroll_v2_contract_at(s,employee_id,job_id,''9999-12-31'',(j->>''contract'')::numeric) is distinct from (j->>''contract'')::numeric then raise exception ''Save the current payroll table after the contract change before confirming the retained balance'';end if;\n amount:=round((j->>''contract'')::numeric');
  if patched=definition then raise exception 'Unexpected retention guard';end if;execute patched;
 end if;
 definition:=pg_get_functiondef('public.payroll_v2_check_cross_date(jsonb,jsonb)'::regprocedure);
 if position('payroll_v2_contract_at' in definition)=0 then
  patched:=replace(definition,'new_history jsonb;','new_history jsonb; expected_contract numeric; old_contract numeric; managed boolean;');
  patched:=replace(patched,'if cap is null and exists',E'managed:=exists(select 1 from jsonb_array_elements(coalesce(new_state->''painterContractEvents'',''[]'')) x where x->>''employeeId''=o.employee and x->>''jobId''=o.job_id);\n  if managed then cap:=payroll_v2_contract_at(new_state,o.employee,o.job_id,''9999-12-31'',payroll_v2_contract_baseline(new_state,o.employee,o.job_id));end if;\n  if cap is null and exists');
  patched:=replace(patched,'if exists(select 1 from payroll_v2_ledger_rows(new_state) where employee=o.employee and job_id=o.job_id and coalesce(rw#>''{job,contractPending}'',''false'')<>''true''::jsonb and round','if not managed and exists(select 1 from payroll_v2_ledger_rows(new_state) where employee=o.employee and job_id=o.job_id and coalesce(rw#>''{job,contractPending}'',''false'')<>''true''::jsonb and round');
  patched:=replace(patched,'if current_rec.rw#>''{job,contractPending}''=''true''::jsonb then',$new$
   select (rw#>>'{job,contract}')::numeric into old_contract from payroll_v2_ledger_rows(old_state) where employee=o.employee and job_id=o.job_id and week=current_rec.week and coalesce(rw#>'{job,contractPending}','false')<>'true'::jsonb limit 1;
   if old_contract is null then old_contract:=payroll_v2_contract_baseline(old_state,o.employee,o.job_id);end if;
   expected_contract:=case when managed then payroll_v2_contract_at(new_state,o.employee,o.job_id,current_rec.week_end,old_contract) else old_contract end;
   if coalesce(current_rec.rw#>'{job,contractPending}','false')<>'true'::jsonb then
    if expected_contract is not null and expected_contract<>(current_rec.rw#>>'{job,contract}')::numeric then raise exception 'Agreed labor for % is %. Use Correct agreed labor or Additional job order.',current_rec.week,expected_contract;end if;
    if (current_rec.rw->>'remaining')::numeric<0 then raise exception 'Payments by % exceed the agreement effective that week; later additional work cannot fund an earlier payment',current_rec.week_end;end if;
   elsif managed and expected_contract is not null then raise exception 'Keep the confirmed agreement effective in this payroll week';end if;
   if current_rec.rw#>'{job,contractPending}'='true'::jsonb then$new$);
  patched:=replace(patched,'then raise exception ''This invoice and plate already have a payroll job. Choose Use existing job instead of creating a duplicate.'';end if;',E'and not payroll_v2_separate_job_allowed(new_state,o.employee,j)\n  then raise exception ''Matching invoice and plate found. Review the matching job and choose Continue this job, or enter a separate transaction reference and reason after release.'';end if;');
  if patched=definition or position('expected_contract:=' in patched)=0 or position('and not payroll_v2_separate_job_allowed' in patched)=0 then raise exception 'Unexpected cross-date guard; no changes applied';end if;
  execute patched;
 end if;
 definition:=pg_get_functiondef('public.payroll_v2_save(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure);
 if position('payroll_v2_check_job_items(old,next_state)' in definition)=0 then raise exception 'Apply payroll update 089 first';end if;
 if position('payroll_v2_check_contract_events(old,next_state,access)' in definition)=0 then
  patched:=replace(definition,'perform payroll_v2_validate(next_state);',E'perform payroll_v2_validate(next_state);\n perform payroll_v2_check_contract_events(old,next_state,access);');
  patched:=replace(patched,'return payroll_v2_load(b,r);',$new$
  if jsonb_array_length(coalesce(next_state->'painterContractEvents','[]'))>jsonb_array_length(coalesce(old->'painterContractEvents','[]')) then
   insert into payroll_v2_events(business_id,branch_id,actor_id,action,details) values(b,r,auth.uid(),'contract_change',jsonb_build_object('revision',current_revision+1,'change',next_state->'painterContractEvents'->-1));
  end if;
  return payroll_v2_load(b,r);$new$);
  if patched=definition then raise exception 'Unexpected payroll save definition';end if;execute patched;
 end if;
end $patch$;
revoke all on function public.payroll_v2_contract_week(text),public.payroll_v2_contract_baseline(jsonb,text,text),public.payroll_v2_contract_at(jsonb,text,text,text,numeric),public.payroll_v2_apply_contract_event(jsonb,jsonb),public.payroll_v2_check_contract_events(jsonb,jsonb,text),public.payroll_v2_separate_job_allowed(jsonb,text,jsonb) from public,anon,authenticated;
commit;
