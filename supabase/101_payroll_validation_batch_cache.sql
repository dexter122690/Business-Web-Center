-- Payroll-only performance: batch existing ledger fingerprints and pass only
-- contract events to helpers that do not need the complete branch history.
-- No data, validation rules, access grants or timeout settings are changed.
begin;
create or replace function public.payroll_v2_ledger_fingerprints(s jsonb) returns jsonb
language sql immutable set search_path=public as $$
 with rows as materialized (select * from payroll_v2_ledger_rows(s)),
 jobs as (select distinct employee,job_id from rows where employee is not null and job_id is not null),
 legacy as materialized (
  select p->>'jobId' job_id,p->>'date' d,round((p->>'gross')::numeric-(p->>'retention')::numeric,2) n
   from jsonb_array_elements(coalesce(s->'payments','[]')) p
  union all select p->>'jobId',p->>'date',round((p->>'amount')::numeric,2)
   from jsonb_array_elements(coalesce(s->'releases','[]')) p),
 payments as (
  select employee,job_id,week start_date,week_end end_date,round((rw->>'weekly')::numeric,2) amount from rows
  union all select j.employee,j.job_id,l.d,l.d,l.n from jobs j join legacy l on l.job_id=j.job_id
   where not exists(select 1 from rows r where r.employee=j.employee and r.job_id=j.job_id and l.d between r.week and r.week_end)),
 row_groups as (
  select employee,job_id,jsonb_agg(jsonb_build_array(week,week_end,rw->'weekly',rw#>'{job,contract}',coalesce(rw#>'{job,contractPending}','false'),coalesce(rw#>'{job,priorSettlement}','0'),rw#>'{job,payrollStart}',rw->'opening',rw->'remaining',rw->'previousRecorded',rw#>'{job,invoice}',rw#>'{job,plate}') order by week,week_end) v
   from rows group by employee,job_id),
 payment_groups as (
  select employee,job_id,jsonb_agg(jsonb_build_array(start_date,end_date,amount) order by start_date,end_date,amount) v
   from payments group by employee,job_id),
 receipt_groups as (
  select p->>'employeeId' employee,p->>'jobId' job_id,jsonb_agg(p order by p->>'id') v
   from jsonb_array_elements(coalesce(s->'painterRetentionReceipts','[]')) p group by p->>'employeeId',p->>'jobId')
 select coalesce(jsonb_object_agg(jsonb_build_array(j.employee,j.job_id)::text,
  jsonb_build_object('rows',coalesce(r.v,'[]'),'payments',coalesce(p.v,'[]'),'receipts',coalesce(c.v,'[]'))),'{}')
 from jobs j left join row_groups r using(employee,job_id) left join payment_groups p using(employee,job_id) left join receipt_groups c using(employee,job_id);
$$;
revoke all on function public.payroll_v2_ledger_fingerprints(jsonb) from public,anon,authenticated;

do $patch$
declare d text;p text;eol text;
 old_check text:=$old$if payroll_v2_ledger_fingerprint(old_state,o.employee,o.job_id)=payroll_v2_ledger_fingerprint(new_state,o.employee,o.job_id) then continue;end if;$old$;
 new_check text:=$new$if coalesce(old_fingerprints->(jsonb_build_array(o.employee,o.job_id)::text),payroll_v2_ledger_fingerprint(old_state,o.employee,o.job_id))
   =coalesce(new_fingerprints->(jsonb_build_array(o.employee,o.job_id)::text),payroll_v2_ledger_fingerprint(new_state,o.employee,o.job_id)) then continue;end if;$new$;
begin
 d:=pg_get_functiondef('public.payroll_v2_check_cross_date(jsonb,jsonb)'::regprocedure);
 if position('-- 101: batch ledger fingerprints' in d)=0 then
  eol:=case when position(E'begin\r\n for o in' in d)>0 then E'\r\n' else E'\n' end;
  if position(old_check in d)=0 or position('new_history jsonb;' in d)=0 or position('begin'||eol||' for o in' in d)=0 then
   raise exception 'Unexpected payroll cross-date validator. Nothing was changed.';end if;
  p:=replace(d,'new_history jsonb;','new_history jsonb; old_fingerprints jsonb; new_fingerprints jsonb;');
  p:=replace(p,'begin'||eol||' for o in','begin'||eol||' -- 101: batch ledger fingerprints; every changed-job check below is unchanged.'||eol||' old_fingerprints:=payroll_v2_ledger_fingerprints(old_state);'||eol||' new_fingerprints:=payroll_v2_ledger_fingerprints(new_state);'||eol||' for o in');
  p:=replace(p,old_check,replace(replace(new_check,E'\r\n',E'\n'),E'\n',eol));
  execute p;
 end if;
 d:=pg_get_functiondef('public.payroll_v2_check_agreements(jsonb,jsonb)'::regprocedure);
 if position('-- 101: compact contract event context' in d)=0 then
  eol:=case when position(E'begin\r\n -- 099:' in d)>0 then E'\r\n' else E'\n' end;
  if position('-- 099: one ledger scan' in d)=0 or position('agreement_variants jsonb;' in d)=0
   or position('payroll_v2_contract_at(new_state,' in d)=0 or position('payroll_v2_agreement_items(new_state,' in d)=0 then
   raise exception 'Unexpected payroll agreement validator. Apply update 099 first.';end if;
  p:=replace(d,'agreement_variants jsonb;','agreement_variants jsonb; contract_context jsonb;');
  p:=replace(p,'begin'||eol||' -- 099:','begin'||eol||' -- 101: compact contract event context; legacy unitemized jobs keep full context.'||eol||' contract_context:=jsonb_build_object(''painterContractEvents'',coalesce(new_state->''painterContractEvents'',''[]''));'||eol||' -- 099:');
  p:=replace(p,'payroll_v2_contract_at(new_state,','payroll_v2_contract_at(contract_context,');
  p:=replace(p,'payroll_v2_agreement_items(new_state,','payroll_v2_agreement_items(case when j->''agreedWorkItems'' is not null then contract_context else new_state end,');
  if position('-- 101: compact contract event context' in p)=0 then raise exception 'Unexpected agreement formatting';end if;
  execute p;
 end if;
end $patch$;
commit;
