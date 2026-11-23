-- One working worksheet per employee/cutoff. No changes to legacy payroll,
-- invoices, Expenses, employee profiles, grants, or permanent PDF files.
begin;

create or replace function public.payroll_v2_compact_worksheets(s jsonb) returns jsonb
language sql immutable set search_path=public as $$
 with sheets as (
  select x,ord,
   min(ord) over(partition by x->>'employeeId',x#>>'{period,start}',x#>>'{period,end}') first_ord,
   max(ord) over(partition by x->>'employeeId',x#>>'{period,start}',x#>>'{period,end}') last_ord
  from jsonb_array_elements(s->'painterTestSheets') with ordinality a(x,ord)
 )
 select jsonb_set(s,'{painterTestSheets}',coalesce((select jsonb_agg(x order by first_ord,ord) from sheets
  where ord=last_ord or exists(select 1 from jsonb_array_elements(s->'releasedPainterSlips') r where r->>'sourceId'=x->>'id')),'[]'));
$$;

create or replace function public.payroll_v2_check_worksheets(old_state jsonb,new_state jsonb) returns void
language plpgsql set search_path=public as $$
declare e jsonb; replacement jsonb;
begin
 if coalesce(jsonb_typeof(new_state->'painterTestSheets'),'')<>'array' then raise exception 'Invalid saved worksheets';end if;
 if exists(select 1 from jsonb_array_elements(new_state->'painterTestSheets') x group by x->>'id' having count(*)>1) then raise exception 'Duplicate worksheet ID';end if;
 for e in select * from jsonb_array_elements(old_state->'painterTestSheets') loop
  if not exists(select 1 from jsonb_array_elements(new_state->'painterTestSheets') n where n->>'employeeId'=e->>'employeeId' and n#>>'{period,start}'=e#>>'{period,start}' and n#>>'{period,end}'=e#>>'{period,end}') then raise exception 'Keep one working worksheet for every saved week';end if;
  select n into replacement from jsonb_array_elements(new_state->'painterTestSheets') n where n->>'id'=e->>'id';
  if replacement is not null and (replacement->>'employeeId' is distinct from e->>'employeeId' or replacement#>>'{period,start}' is distinct from e#>>'{period,start}' or replacement#>>'{period,end}' is distinct from e#>>'{period,end}') then raise exception 'A worksheet cannot be moved to another employee or week';end if;
  if exists(select 1 from jsonb_array_elements(old_state->'releasedPainterSlips') r where r->>'sourceId'=e->>'id') and replacement is distinct from e then raise exception 'Released worksheet sources are read-only';end if;
  if replacement is not null and replacement<>e and exists(select 1 from jsonb_array_elements(old_state->'releasedPainterSlips') r where r->>'employeeId'=e->>'employeeId' and r#>>'{period,start}'=e#>>'{period,start}' and r#>>'{period,end}'=e#>>'{period,end}') then raise exception 'Void the released payslip before correcting this week';end if;
 end loop;
 -- Cleanup must not roll a week back to an older existing revision.
 for e in select distinct on (x->>'employeeId',x#>>'{period,start}',x#>>'{period,end}') x
  from jsonb_array_elements(old_state->'painterTestSheets') with ordinality a(x,ord)
  order by x->>'employeeId',x#>>'{period,start}',x#>>'{period,end}',ord desc loop
  select n into replacement from jsonb_array_elements(new_state->'painterTestSheets') with ordinality a(n,ord)
   where n->>'employeeId'=e->>'employeeId' and n#>>'{period,start}'=e#>>'{period,start}' and n#>>'{period,end}'=e#>>'{period,end}' order by ord desc limit 1;
  if replacement->>'id'<>e->>'id' and exists(select 1 from jsonb_array_elements(old_state->'painterTestSheets') x where x->>'id'=replacement->>'id') then raise exception 'Keep the latest working worksheet, not an older copy';end if;
 end loop;
end $$;

-- Retain the existing, tested authorization/revision/file/release checks.
-- Fail closed if the installed save function does not match the expected base.
do $$
declare definition text; patched text;
begin
 definition:=pg_get_functiondef('public.payroll_v2_save(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure);
 if position('payroll_v2_check_worksheets(old,next_state)' in definition)=0 then
  patched:=replace(definition,'perform payroll_v2_validate(next_state);',
   E'perform payroll_v2_check_worksheets(old,next_state);\n next_state:=payroll_v2_compact_worksheets(next_state);\n perform payroll_v2_validate(next_state);');
  if patched=definition then raise exception 'Unexpected payroll save definition: validation anchor missing';end if;
  definition:=patched;
  patched:=replace(definition,
   'foreach k in array array[''painterTestSheets'',''releasedPainterSlips'',''payslips'',''slipReleases'',''legacyReleases''] loop',
   'foreach k in array array[''releasedPainterSlips'',''payslips'',''slipReleases'',''legacyReleases''] loop');
  if patched=definition then raise exception 'Unexpected payroll save definition: archive protection anchor missing';end if;
  execute patched;
 end if;
end $$;
revoke all on function public.payroll_v2_compact_worksheets(jsonb) from public,anon,authenticated;
revoke all on function public.payroll_v2_check_worksheets(jsonb,jsonb) from public,anon,authenticated;

-- Limited cleanup for this BWC business only. The last entry per employee/week
-- is byte-for-byte preserved, together with any released PDF source. Revision
-- increments stop already-open clients from restoring the obsolete duplicates.
do $$
declare w record; cleaned jsonb; removed integer;
begin
 for w in select * from public.payroll_v2_workspaces
  where business_id='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875'::uuid order by branch_id for update loop
  cleaned:=payroll_v2_compact_worksheets(w.state);
  removed:=jsonb_array_length(w.state->'painterTestSheets')-jsonb_array_length(cleaned->'painterTestSheets');
  if removed>0 then
   perform payroll_v2_check_worksheets(w.state,cleaned);
   perform payroll_v2_validate(cleaned);
   update public.payroll_v2_workspaces set state=cleaned,revision=revision+1,updated_at=now() where business_id=w.business_id and branch_id=w.branch_id;
   insert into public.payroll_v2_events(business_id,branch_id,actor_id,action,details)
    values(w.business_id,w.branch_id,null,'worksheet_deduplication',jsonb_build_object('migration','080','removed_duplicates',removed,'retained_worksheets',jsonb_array_length(cleaned->'painterTestSheets')));
  end if;
 end loop;
end $$;
commit;
