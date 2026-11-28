-- Payroll-only performance fix. No rows, amounts, files, grants or rules change.
-- Cache agreement variants once instead of rescanning every payroll worksheet
-- separately for every job row. All existing validation and errors are retained.
begin;
do $patch$
declare definition text; patched text; validator_eol text;
 old_check text:=$old$if exists(select 1 from payroll_v2_ledger_rows(new_state) x where x.employee=sh->>'employeeId' and x.job_id=j->>'id' and x.rw#>'{job,agreedWorkItems}' is distinct from items)$old$;
 new_check text:=$new$if sh->>'employeeId' is not null and j->>'id' is not null
     and agreement_variants ? jsonb_build_array(sh->>'employeeId',j->>'id')::text
     and agreement_variants->(jsonb_build_array(sh->>'employeeId',j->>'id')::text) is distinct from jsonb_build_array(items)$new$;
 cache_sql text:=$cache$begin
 -- 099: one ledger scan; array/object ordering and missing agreements remain checked.
 select coalesce(jsonb_object_agg(k,variants),'{}'::jsonb) into agreement_variants
 from (
  select jsonb_build_array(lr.employee,lr.job_id)::text k,
   jsonb_agg(distinct coalesce(lr.rw#>'{job,agreedWorkItems}','null'::jsonb)) variants
  from payroll_v2_ledger_rows(new_state) lr group by lr.employee,lr.job_id
 ) agreement_groups;
$cache$;
begin
 definition:=pg_get_functiondef('public.payroll_v2_check_agreements(jsonb,jsonb)'::regprocedure);
 if position('-- 099: one ledger scan' in definition)>0 then return;end if;
 validator_eol:=case when position(E'begin\r\n for sh in' in definition)>0 then E'\r\n' else E'\n' end;
 new_check:=replace(replace(new_check,E'\r\n',E'\n'),E'\n',validator_eol);
 cache_sql:=replace(replace(cache_sql,E'\r\n',E'\n'),E'\n',validator_eol);
 if position(old_check in definition)=0 or position('expected numeric;' in definition)=0
  or position('begin'||validator_eol||' for sh in' in definition)=0 then
  raise exception 'Unexpected payroll agreement validator. Nothing was changed.';
 end if;
 patched:=replace(definition,'expected numeric;','expected numeric; agreement_variants jsonb;');
 patched:=replace(patched,'begin'||validator_eol||' for sh in',cache_sql||' for sh in');
 patched:=replace(patched,old_check,new_check);
 if patched=definition or position(old_check in patched)>0 then raise exception 'Payroll optimization could not be verified';end if;
 execute patched;
end $patch$;
commit;
