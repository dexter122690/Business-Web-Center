-- Job prices belong to the agreement; weekly payment remains a separate amount.
-- Additive validation only. This migration does not reset any workspace.
begin;
create or replace function public.payroll_v2_agreement_items(s jsonb,e text,j jsonb,through_day text) returns jsonb
language plpgsql immutable set search_path=public as $$
declare items jsonb; ev jsonb;
begin
 items:=coalesce(j->'agreedWorkItems',jsonb_build_array(jsonb_build_object('description',coalesce(nullif(j->>'work',''),'Existing labor agreement (not itemized)'),
 'amount',coalesce(payroll_v2_contract_baseline(s,e,j->>'id'),(j->>'contract')::numeric))));
 for ev in select x from jsonb_array_elements(coalesce(s->'painterContractEvents','[]')) with ordinality a(x,n)
  where x->>'employeeId'=e and x->>'jobId'=j->>'id' and payroll_v2_contract_week(x->>'effectiveOn')<=through_day order by n loop
  if ev->>'kind'='addition' then items:=items||jsonb_build_array(jsonb_build_object('description',ev->>'description','amount',ev->'amount'));
  else items:=jsonb_build_array(jsonb_build_object('description',ev->>'description','amount',ev->'amount'));end if;
 end loop;
 return items;
end $$;

-- Preserve legacy validation, changing only the sum check for manual-payment rows.
do $$
declare d text; p text;
begin
 d:=pg_get_functiondef('public.payroll_v2_check_job_items(jsonb,jsonb)'::regprocedure);
 if position('rw->''weeklyManual''' in d)=0 then
  p:=replace(d,'if round((rw->>''weekly'')::numeric,2) is distinct from round(total,2) or rw#>>''{job,work}'' is distinct from description then',
   'if coalesce(rw->''weeklyManual'',''false'')<>''true''::jsonb and (round((rw->>''weekly'')::numeric,2) is distinct from round(total,2) or rw#>>''{job,work}'' is distinct from description) then');
  if p=d then raise exception 'Apply job-items update 089 first';end if;execute p;
 end if;
end $$;

create or replace function public.payroll_v2_check_agreements(old_state jsonb,new_state jsonb) returns void
language plpgsql set search_path=public as $$
declare sh jsonb;rw jsonb;j jsonb;i jsonb;items jsonb;total numeric;description text;expected numeric;
begin
 for sh in select * from jsonb_array_elements(new_state->'painterTestSheets') loop
  for rw in select * from jsonb_array_elements(sh#>'{snapshot,rows}') loop
   j:=rw->'job';
   if j ? 'pricingSetup' then raise exception 'Local reset samples cannot be imported into live payroll';end if;
   if rw ? 'weeklyManual' and jsonb_typeof(rw->'weeklyManual')<>'boolean' then raise exception 'Invalid weekly payment mode';end if;
   if j ? 'agreedWorkItems' then
    items:=j->'agreedWorkItems';
    if jsonb_typeof(items) is distinct from 'array' then raise exception 'Invalid agreed job lines';end if;
    if jsonb_array_length(items) not between 1 and 30 then raise exception 'Enter 1 to 30 agreed job lines';end if;
    for i in select * from jsonb_array_elements(items) loop
     if jsonb_typeof(i->'description') is distinct from 'string' or jsonb_typeof(i->'amount') is distinct from 'number'
      or length(btrim(i->>'description')) not between 1 and 1000 or i->>'description'<>btrim(i->>'description')
      or (i->>'amount')::numeric<=0 or (i->>'amount')::numeric>999999999 or round((i->>'amount')::numeric,2)<>(i->>'amount')::numeric
      or i-'description'-'amount'<>'{}'::jsonb then raise exception 'Enter a description and positive agreed price for each job';end if;
    end loop;
    select sum((x->>'amount')::numeric),string_agg(x->>'description',E'\n' order by n) into total,description from jsonb_array_elements(items) with ordinality a(x,n);
    expected:=payroll_v2_contract_at(new_state,sh->>'employeeId',j->>'id',sh#>>'{period,end}',total);
    if total>999999999 or j->'contractPending'='true'::jsonb or (j->>'contract')::numeric is distinct from expected or j->>'work' is distinct from description
     or rw->'weeklyManual' is distinct from 'true'::jsonb then raise exception 'Agreed labor must equal job prices plus applicable additional work; weekly pay is separate';end if;
    if exists(select 1 from payroll_v2_ledger_rows(new_state) x where x.employee=sh->>'employeeId' and x.job_id=j->>'id' and x.rw#>'{job,agreedWorkItems}' is distinct from items)
     then raise exception 'Keep identical agreed job prices across all payroll dates';end if;
   end if;
   if rw->'weeklyManual'='true'::jsonb then
    items:=payroll_v2_agreement_items(new_state,sh->>'employeeId',j,sh#>>'{period,end}');
    if rw->'agreementItems' is distinct from items or (j->'contractPending' is distinct from 'true'::jsonb and
     (select sum((x->>'amount')::numeric) from jsonb_array_elements(items) x) is distinct from (j->>'contract')::numeric)
     then raise exception 'Job-order prices do not match the effective agreement';end if;
   end if;
  end loop;
 end loop;
 if exists(select 1 from payroll_v2_ledger_rows(old_state) o join payroll_v2_ledger_rows(new_state) n on n.employee=o.employee and n.job_id=o.job_id
  where o.rw#>'{job,agreedWorkItems}' is distinct from n.rw#>'{job,agreedWorkItems}') then raise exception 'Saved job prices are locked. Use Additional job order';end if;
 if exists(select 1 from payroll_v2_ledger_rows(old_state) o join payroll_v2_ledger_rows(new_state) n on n.employee=o.employee and n.job_id=o.job_id and n.week=o.week
  where (o.rw->'weeklyManual'='true'::jsonb and n.rw->'weeklyManual' is distinct from 'true'::jsonb)
   or (n.rw->'weeklyManual'='true'::jsonb and o.rw ? 'workItems' and o.rw->'workItems' is distinct from n.rw->'workItems'))
  then raise exception 'Keep legacy job details and separate weekly payment mode';end if;
end $$;

do $$
declare d text;p text;
begin
 d:=pg_get_functiondef('public.payroll_v2_apply_contract_event(jsonb,jsonb)'::regprocedure);
 if position('payroll_v2_agreement_items' in d)=0 then
  p:=replace(d,$a$-'baselineAmount'-'recordedAt'<>'{}'::jsonb$a$,$b$-'baselineAmount'-'recordedAt'-'itemizedAgreement'<>'{}'::jsonb or (ev ? 'itemizedAgreement' and ev->'itemizedAgreement' is distinct from 'true'::jsonb)$b$);
  if p=d then raise exception 'Apply contract update 093 first';end if;
  p:=replace(p,'baseline:=payroll_v2_contract_baseline(s,e,j);',$x$
  if ev->>'kind'<>'addition' and exists(select 1 from payroll_v2_ledger_rows(s) lr where lr.employee=e and lr.job_id=j and lr.rw#>'{job,agreedWorkItems}' is not null) then raise exception 'Saved job prices are locked. Use Additional job order';end if;
  baseline:=payroll_v2_contract_baseline(s,e,j);$x$);
  p:=replace(p,'changed:=true;',$x$changed:=true;
  if rw->'weeklyManual'='true'::jsonb or rw#>'{job,agreedWorkItems}' is not null or ev->'itemizedAgreement'='true'::jsonb then
   rw:=jsonb_set(jsonb_set(rw,'{weeklyManual}','true'),'{agreementItems}',payroll_v2_agreement_items(result,e,rw->'job',sh#>>'{period,end}'));
  end if;$x$);
  execute p;
 end if;
 d:=pg_get_functiondef('public.payroll_v2_save(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure);
 if position('payroll_v2_check_agreements' in d)=0 then
  p:=replace(d,'perform payroll_v2_check_job_items(old,next_state);',E'perform payroll_v2_check_job_items(old,next_state);\n perform payroll_v2_check_agreements(old,next_state);');
  if p=d then raise exception 'Unexpected payroll save definition';end if;execute p;
 end if;
end $$;
revoke all on function public.payroll_v2_agreement_items(jsonb,text,jsonb,text),public.payroll_v2_check_agreements(jsonb,jsonb) from public,anon,authenticated;
commit;
