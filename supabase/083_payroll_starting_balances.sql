-- Validate optional per-unit pre-BWC settlements. No records or grants are changed.
begin;
create or replace function public.payroll_v2_check_starting_balances(old_state jsonb,new_state jsonb) returns void
language plpgsql set search_path=public as $$
declare old_sheets jsonb; new_sheets jsonb; current_sheet jsonb; current_row jsonb; j jsonb; o record;
begin
 select coalesce(jsonb_agg(x),'[]') into old_sheets from (
  select distinct on (x->>'employeeId',x#>>'{period,start}',x#>>'{period,end}') x
  from jsonb_array_elements(old_state->'painterTestSheets') with ordinality a(x,n)
  order by x->>'employeeId',x#>>'{period,start}',x#>>'{period,end}',n desc) q;
 select coalesce(jsonb_agg(x),'[]') into new_sheets from (
  select distinct on (x->>'employeeId',x#>>'{period,start}',x#>>'{period,end}') x
  from jsonb_array_elements(new_state->'painterTestSheets') with ordinality a(x,n)
  order by x->>'employeeId',x#>>'{period,start}',x#>>'{period,end}',n desc) q;
 for current_sheet in select * from jsonb_array_elements(new_state->'painterTestSheets') loop
  for current_row in select * from jsonb_array_elements(current_sheet#>'{snapshot,rows}') loop
   j:=current_row->'job';
   if j ? 'priorSettlement' or j ? 'payrollStart' then
    if coalesce(jsonb_typeof(j->'priorSettlement'),'')<>'number'
     or coalesce((j->>'priorSettlement')::numeric,-1) not between 0 and coalesce((j->>'contract')::numeric,-1)
     or coalesce(j->>'payrollStart','') !~ '^\d{4}-\d{2}-\d{2}$'
     or extract(dow from (j->>'payrollStart')::date)<>6
     or j->>'payrollStart'>current_sheet#>>'{period,start}' then raise exception 'Invalid pre-BWC starting balance';end if;
   end if;
  end loop;
 end loop;
 for o in select distinct rw#>>'{job,id}' id,rw#>>'{job,payrollStart}' start,rw#>'{job,priorSettlement}' amount,sh->>'employeeId' employee
  from jsonb_array_elements(new_sheets) sh cross join lateral jsonb_array_elements(sh#>'{snapshot,rows}') rw where rw->'job' ? 'payrollStart' loop
  if exists(select 1 from jsonb_array_elements(new_sheets) sh cross join lateral jsonb_array_elements(sh#>'{snapshot,rows}') rw
   where rw#>>'{job,id}'=o.id and (sh->>'employeeId' is distinct from o.employee or rw#>>'{job,payrollStart}' is distinct from o.start or rw#>'{job,priorSettlement}' is distinct from o.amount)) then raise exception 'Keep the same pre-BWC starting balance across payroll weeks';end if;
  if not exists(select 1 from jsonb_array_elements(new_sheets) sh cross join lateral jsonb_array_elements(sh#>'{snapshot,rows}') rw
   where rw#>>'{job,id}'=o.id and sh#>>'{period,start}'=o.start) then raise exception 'Keep the first BWC worksheet that records this starting balance';end if;
  if exists(select 1 from jsonb_array_elements(new_sheets) sh cross join lateral jsonb_array_elements(sh#>'{snapshot,rows}') rw
   where rw#>>'{job,id}'=o.id and round((rw->>'opening')::numeric,2)<>round((rw#>>'{job,contract}')::numeric-(o.amount#>>'{}')::numeric-
    (select coalesce(sum((pr->>'weekly')::numeric),0) from jsonb_array_elements(new_sheets) ps cross join lateral jsonb_array_elements(ps#>'{snapshot,rows}') pr where pr#>>'{job,id}'=o.id and ps#>>'{period,end}'<sh#>>'{period,start}'),2)) then raise exception 'Starting balance does not match earlier payroll; a later worksheet may depend on the amount being changed';end if;
  if exists(select 1 from jsonb_array_elements(coalesce(new_state->'payments','[]')||coalesce(new_state->'releases','[]')) p where p->>'jobId'=o.id) then raise exception 'Do not combine an opening settlement with legacy payment entries for the same unit';end if;
  if exists(select 1 from jsonb_array_elements(old_sheets) sh cross join lateral jsonb_array_elements(sh#>'{snapshot,rows}') rw
   where rw#>>'{job,id}'=o.id and (rw#>>'{job,payrollStart}' is distinct from o.start or rw#>'{job,priorSettlement}' is distinct from o.amount))
   and exists(select 1 from jsonb_array_elements(old_sheets) sh cross join lateral jsonb_array_elements(sh#>'{snapshot,rows}') rw
   where rw#>>'{job,id}'=o.id and sh#>>'{period,start}'<>o.start) then raise exception 'Starting balance is locked because this unit has other payroll records';end if;
 end loop;
 -- An older client must not silently remove the opening metadata from a unit.
 for o in select distinct rw#>>'{job,id}' id from jsonb_array_elements(old_sheets) sh cross join lateral jsonb_array_elements(sh#>'{snapshot,rows}') rw where rw->'job' ? 'payrollStart' loop
  if exists(select 1 from jsonb_array_elements(new_sheets) sh cross join lateral jsonb_array_elements(sh#>'{snapshot,rows}') rw where rw#>>'{job,id}'=o.id)
   and not exists(select 1 from jsonb_array_elements(new_sheets) sh cross join lateral jsonb_array_elements(sh#>'{snapshot,rows}') rw where rw#>>'{job,id}'=o.id and rw->'job' ? 'payrollStart') then raise exception 'Keep the unit pre-BWC starting balance';end if;
 end loop;
end $$;
do $patch$
declare definition text; patched text;
begin
 definition:=pg_get_functiondef('public.payroll_v2_save(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure);
 if position('payroll_v2_check_worksheets(old,next_state)' in definition)=0 then raise exception 'Apply payroll update 080 first';end if;
 if position('payroll_v2_check_starting_balances(old,next_state)' in definition)=0 then
  patched:=replace(definition,'perform payroll_v2_validate(next_state);',E'perform payroll_v2_validate(next_state);\n perform payroll_v2_check_starting_balances(old,next_state);');
  if patched=definition then raise exception 'Unexpected payroll save definition; nothing changed';end if;
  execute patched;
 end if;
end $patch$;
revoke all on function public.payroll_v2_check_starting_balances(jsonb,jsonb) from public,anon,authenticated;
commit;
