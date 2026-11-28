-- Manual payroll-code rollback only. No records or files are modified.
begin;
do $patch$
declare d text;p text;eol text;
 original text:=$old$if payroll_v2_ledger_fingerprint(old_state,o.employee,o.job_id)=payroll_v2_ledger_fingerprint(new_state,o.employee,o.job_id) then continue;end if;$old$;
 cached text:=$new$if coalesce(old_fingerprints->(jsonb_build_array(o.employee,o.job_id)::text),payroll_v2_ledger_fingerprint(old_state,o.employee,o.job_id))
   =coalesce(new_fingerprints->(jsonb_build_array(o.employee,o.job_id)::text),payroll_v2_ledger_fingerprint(new_state,o.employee,o.job_id)) then continue;end if;$new$;
begin
 d:=pg_get_functiondef('public.payroll_v2_check_cross_date(jsonb,jsonb)'::regprocedure);
 if position('-- 101: batch ledger fingerprints' in d)>0 then
  eol:=case when position(E'begin\r\n -- 101:' in d)>0 then E'\r\n' else E'\n' end;
  p:=replace(d,'new_history jsonb; old_fingerprints jsonb; new_fingerprints jsonb;','new_history jsonb;');
  p:=replace(p,'begin'||eol||' -- 101: batch ledger fingerprints; every changed-job check below is unchanged.'||eol||' old_fingerprints:=payroll_v2_ledger_fingerprints(old_state);'||eol||' new_fingerprints:=payroll_v2_ledger_fingerprints(new_state);'||eol||' for o in','begin'||eol||' for o in');
  p:=replace(p,replace(replace(cached,E'\r\n',E'\n'),E'\n',eol),original);
  if position('old_fingerprints' in p)>0 or p=d then raise exception 'Unexpected cross-date validator; rollback cancelled';end if;execute p;
 end if;
 d:=pg_get_functiondef('public.payroll_v2_check_agreements(jsonb,jsonb)'::regprocedure);
 if position('-- 101: compact contract event context' in d)>0 then
  eol:=case when position(E'begin\r\n -- 101:' in d)>0 then E'\r\n' else E'\n' end;
  p:=replace(d,'agreement_variants jsonb; contract_context jsonb;','agreement_variants jsonb;');
  p:=replace(p,'begin'||eol||' -- 101: compact contract event context; legacy unitemized jobs keep full context.'||eol||' contract_context:=jsonb_build_object(''painterContractEvents'',coalesce(new_state->''painterContractEvents'',''[]''));'||eol||' -- 099:','begin'||eol||' -- 099:');
  p:=replace(p,'payroll_v2_contract_at(contract_context,','payroll_v2_contract_at(new_state,');
  p:=replace(p,'payroll_v2_agreement_items(case when j->''agreedWorkItems'' is not null then contract_context else new_state end,','payroll_v2_agreement_items(new_state,');
  if position('contract_context' in p)>0 or p=d then raise exception 'Unexpected agreement validator; rollback cancelled';end if;execute p;
 end if;
end $patch$;
drop function if exists public.payroll_v2_ledger_fingerprints(jsonb);
commit;
