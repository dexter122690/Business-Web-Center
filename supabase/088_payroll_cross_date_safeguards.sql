-- Transition-only safeguards. No payroll amounts, profiles, files or grants are changed.
begin;
create or replace function public.payroll_v2_ledger_rows(s jsonb)
returns table(employee text,job_id text,week text,week_end text,rw jsonb)
language sql immutable set search_path=public as $$
 with sheets as (
  select distinct on (x->>'employeeId',x#>>'{period,start}',x#>>'{period,end}') x
  from jsonb_array_elements(coalesce(s->'painterTestSheets','[]')) with ordinality a(x,n)
  order by x->>'employeeId',x#>>'{period,start}',x#>>'{period,end}',n desc)
 select x->>'employeeId',r#>>'{job,id}',x#>>'{period,start}',x#>>'{period,end}',r
 from sheets cross join lateral jsonb_array_elements(x#>'{snapshot,rows}') r;
$$;
create or replace function public.payroll_v2_ledger_payments(s jsonb,e text,j text)
returns table(start_date text,end_date text,amount numeric)
language sql immutable set search_path=public as $$
 with rows as (select * from payroll_v2_ledger_rows(s) where employee=e and job_id=j),
 legacy as (
  select p->>'date' d,round((p->>'gross')::numeric-(p->>'retention')::numeric,2) n from jsonb_array_elements(coalesce(s->'payments','[]')) p where p->>'jobId'=j
  union all select p->>'date',round((p->>'amount')::numeric,2) from jsonb_array_elements(coalesce(s->'releases','[]')) p where p->>'jobId'=j)
 select week,week_end,round((rw->>'weekly')::numeric,2) from rows
 union all select d,d,n from legacy where not exists(select 1 from rows where d between week and week_end);
$$;
create or replace function public.payroll_v2_ledger_fingerprint(s jsonb,e text,j text) returns jsonb
language sql immutable set search_path=public as $$
 select jsonb_build_object('rows',(select coalesce(jsonb_agg(jsonb_build_array(week,week_end,rw->'weekly',rw#>'{job,contract}',coalesce(rw#>'{job,contractPending}','false'),coalesce(rw#>'{job,priorSettlement}','0'),rw#>'{job,payrollStart}',rw->'opening',rw->'remaining',rw->'previousRecorded',rw#>'{job,invoice}',rw#>'{job,plate}') order by week,week_end),'[]') from payroll_v2_ledger_rows(s) where employee=e and job_id=j),
 'payments',(select coalesce(jsonb_agg(jsonb_build_array(start_date,end_date,amount) order by start_date,end_date,amount),'[]') from payroll_v2_ledger_payments(s,e,j)),
 'receipts',(select coalesce(jsonb_agg(p order by p->>'id'),'[]') from jsonb_array_elements(coalesce(s->'painterRetentionReceipts','[]')) p where p->>'employeeId'=e and p->>'jobId'=j));
$$;
create or replace function public.payroll_v2_safe_earlier_anchor(s jsonb,e text,j text,new_start text,new_amount jsonb) returns boolean
language sql immutable set search_path=public as $$
 select coalesce(new_amount='0'::jsonb
 and exists(select 1 from payroll_v2_ledger_rows(s) where employee=e and job_id=j)
 and not exists(select 1 from payroll_v2_ledger_rows(s) where employee=e and job_id=j and
  (coalesce((rw#>>'{job,priorSettlement}')::numeric,0)<>0 or coalesce(rw#>>'{job,payrollStart}','')<=new_start or week<=new_start))
 and not exists(select 1 from jsonb_array_elements(coalesce(s->'releasedPainterSlips','[]')) x cross join lateral jsonb_array_elements(x#>'{snapshot,rows}') r where x->>'employeeId'=e and r#>>'{job,id}'=j)
 and not exists(select 1 from jsonb_array_elements(coalesce(s->'painterRetentionReceipts','[]')) p where p->>'employeeId'=e and p->>'jobId'=j),false);
$$;
create or replace function public.payroll_v2_check_cross_date(old_state jsonb,new_state jsonb) returns void
language plpgsql set search_path=public as $$
declare o record; current_rec record; slip jsonb; j jsonb; cap numeric; paid numeric; prior numeric; old_history jsonb; new_history jsonb;
begin
 for o in select distinct employee,job_id from payroll_v2_ledger_rows(new_state) loop
  if payroll_v2_ledger_fingerprint(old_state,o.employee,o.job_id)=payroll_v2_ledger_fingerprint(new_state,o.employee,o.job_id) then continue;end if;
  select rw->'job' into j from payroll_v2_ledger_rows(new_state) where employee=o.employee and job_id=o.job_id order by week desc limit 1;
  select (rw#>>'{job,contract}')::numeric into cap from payroll_v2_ledger_rows(new_state) where employee=o.employee and job_id=o.job_id and coalesce(rw#>'{job,contractPending}','false')<>'true'::jsonb order by week desc limit 1;
  if cap is null and exists(select 1 from payroll_v2_ledger_rows(old_state) where employee=o.employee and job_id=o.job_id and coalesce(rw#>'{job,contractPending}','false')<>'true'::jsonb) then raise exception 'An already confirmed agreed labor cannot be cleared';end if;
  if cap is not null then
   if exists(select 1 from payroll_v2_ledger_rows(new_state) where employee=o.employee and job_id=o.job_id and coalesce(rw#>'{job,contractPending}','false')<>'true'::jsonb and round((rw#>>'{job,contract}')::numeric,2)<>round(cap,2)) then raise exception 'Keep the same agreed labor for this job across all dates';end if;
   select coalesce(sum(amount),0)+coalesce((j->>'priorSettlement')::numeric,0)+(select coalesce(sum((p->>'amount')::numeric),0) from jsonb_array_elements(coalesce(new_state->'painterRetentionReceipts','[]')) p where p->>'employeeId'=o.employee and p->>'jobId'=o.job_id)
    into paid from payroll_v2_ledger_payments(new_state,o.employee,o.job_id);
   if round(paid,2)>round(cap,2) then raise exception 'Payments across all dates exceed agreed labor for %. Earlier/later payments and received retention are included.',j->>'unit';end if;
  end if;
  for current_rec in select * from payroll_v2_ledger_rows(new_state) where employee=o.employee and job_id=o.job_id loop
   select coalesce(sum(amount),0)+coalesce((current_rec.rw#>>'{job,priorSettlement}')::numeric,0) into prior from payroll_v2_ledger_payments(new_state,o.employee,o.job_id) where end_date<current_rec.week;
   if current_rec.rw#>'{job,contractPending}'='true'::jsonb then
    if round((current_rec.rw->>'previousRecorded')::numeric,2) is distinct from round(prior,2) then raise exception 'Pending previous payments do not match other payroll dates';end if;
   elsif round((current_rec.rw->>'opening')::numeric,2) is distinct from round((current_rec.rw#>>'{job,contract}')::numeric-prior,2) then raise exception 'Balance does not match payments on other dates; recalculate the later worksheets';end if;
  end loop;
  for slip in select * from jsonb_array_elements(coalesce(old_state->'releasedPainterSlips','[]')) x where x->>'employeeId'=o.employee and exists(select 1 from jsonb_array_elements(x#>'{snapshot,rows}') r where r#>>'{job,id}'=o.job_id) loop
   select coalesce(jsonb_agg(jsonb_build_array(start_date,end_date,amount) order by start_date,end_date,amount),'[]') into old_history from payroll_v2_ledger_payments(old_state,o.employee,o.job_id) where end_date<slip#>>'{period,start}' and amount<>0;
   select coalesce(jsonb_agg(jsonb_build_array(start_date,end_date,amount) order by start_date,end_date,amount),'[]') into new_history from payroll_v2_ledger_payments(new_state,o.employee,o.job_id) where end_date<slip#>>'{period,start}' and amount<>0;
   if old_history<>new_history then raise exception 'A later released payslip includes this payment history. Use an owner-reviewed correction; the original copy is locked.';end if;
  end loop;
  if nullif(btrim(j->>'invoice'),'') is not null and nullif(btrim(j->>'plate'),'') is not null
   and not exists(select 1 from payroll_v2_ledger_rows(old_state) where employee=o.employee and job_id=o.job_id and upper(btrim(rw#>>'{job,invoice}'))=upper(btrim(j->>'invoice')) and upper(btrim(rw#>>'{job,plate}'))=upper(btrim(j->>'plate')))
   and exists(select 1 from payroll_v2_ledger_rows(new_state) where employee=o.employee and job_id<>o.job_id and upper(btrim(rw#>>'{job,invoice}'))=upper(btrim(j->>'invoice')) and upper(btrim(rw#>>'{job,plate}'))=upper(btrim(j->>'plate')))
  then raise exception 'This invoice and plate already have a payroll job. Choose Use existing job instead of creating a duplicate.';end if;
 end loop;
end $$;
do $patch$
declare definition text; patched text;
begin
 definition:=pg_get_functiondef('public.payroll_v2_check_starting_balances(jsonb,jsonb)'::regprocedure);
 if position('payroll_v2_safe_earlier_anchor' in definition)=0 then
  patched:=replace(definition,$old$then raise exception 'Starting balance is locked because this unit has other payroll records'$old$,$new$and not payroll_v2_safe_earlier_anchor(old_state,o.employee,o.id,o.start,o.amount) then raise exception 'Starting balance is locked because this unit has other payroll records'$new$);
  if patched=definition then raise exception 'Unexpected starting-balance guard; nothing changed';end if;execute patched;
 end if;
 definition:=pg_get_functiondef('public.payroll_v2_save(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure);
 if position('payroll_v2_check_retention_receipts(old,next_state)' in definition)=0 then raise exception 'Apply payroll update 087 first';end if;
 if position('payroll_v2_check_cross_date(old,next_state)' in definition)=0 then
  patched:=replace(definition,'perform payroll_v2_validate(next_state);',E'perform payroll_v2_validate(next_state);\n perform payroll_v2_check_cross_date(old,next_state);');
  if patched=definition then raise exception 'Unexpected payroll save definition; nothing changed';end if;execute patched;
 end if;
end $patch$;
revoke all on function public.payroll_v2_ledger_rows(jsonb),public.payroll_v2_ledger_payments(jsonb,text,text),public.payroll_v2_ledger_fingerprint(jsonb,text,text),public.payroll_v2_safe_earlier_anchor(jsonb,text,text,text,jsonb),public.payroll_v2_check_cross_date(jsonb,jsonb) from public,anon,authenticated;
commit;
