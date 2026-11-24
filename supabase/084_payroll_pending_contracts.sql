-- Unknown agreed labor is null, never a guessed zero. No data or access grants change.
begin;
create or replace function public.payroll_v2_valid_painter_amount(rw jsonb) returns boolean
language sql immutable set search_path=public as $$
 select coalesce(
  jsonb_typeof(rw->'weekly')='number' and (rw->>'weekly')::numeric between 0 and 999999999
  and (not (rw->'job' ? 'contractPending') or jsonb_typeof(rw#>'{job,contractPending}')='boolean')
  and case when rw#>'{job,contractPending}'='true'::jsonb then
   rw#>'{job,contract}'='null'::jsonb and rw->'opening'='null'::jsonb and rw->'remaining'='null'::jsonb
   and jsonb_typeof(rw->'previousRecorded')='number' and (rw->>'previousRecorded')::numeric between 0 and 999999999
  else jsonb_typeof(rw#>'{job,contract}')='number' and (rw#>>'{job,contract}')::numeric between 0 and 999999999
   and jsonb_typeof(rw->'opening')='number' and jsonb_typeof(rw->'remaining')='number'
   and round((rw->>'remaining')::numeric,2)=round((rw->>'opening')::numeric-(rw->>'weekly')::numeric,2)
  end,false);
$$;
create or replace function public.payroll_v2_check_pending_contracts(s jsonb) returns void
language plpgsql set search_path=public as $$
declare sheets jsonb; sh jsonb; rw jsonb; previous_paid numeric;
begin
 select coalesce(jsonb_agg(x),'[]') into sheets from (
  select distinct on (x->>'employeeId',x#>>'{period,start}',x#>>'{period,end}') x
  from jsonb_array_elements(s->'painterTestSheets') with ordinality a(x,n)
  order by x->>'employeeId',x#>>'{period,start}',x#>>'{period,end}',n desc) q;
 for sh in select * from jsonb_array_elements(sheets) loop
  for rw in select * from jsonb_array_elements(sh#>'{snapshot,rows}') where value#>'{job,contractPending}'='true'::jsonb loop
   if exists(select 1 from jsonb_array_elements(coalesce(s->'payments','[]')||coalesce(s->'releases','[]')) p where p->>'jobId'=rw#>>'{job,id}') then raise exception 'Review legacy payments before marking this contract pending';end if;
   select coalesce(sum((pr->>'weekly')::numeric),0)+coalesce((rw#>>'{job,priorSettlement}')::numeric,0) into previous_paid
    from jsonb_array_elements(sheets) ps cross join lateral jsonb_array_elements(ps#>'{snapshot,rows}') pr
    where ps->>'employeeId'=sh->>'employeeId' and ps#>>'{period,end}'<sh#>>'{period,start}' and pr#>>'{job,id}'=rw#>>'{job,id}';
   if (rw->>'previousRecorded')::numeric is null or round((rw->>'previousRecorded')::numeric,2)<>round(previous_paid,2) then raise exception 'Pending contract previous payments do not match earlier payroll';end if;
  end loop;
 end loop;
end $$;
do $patch$
declare definition text; patched text;
begin
 definition:=pg_get_functiondef('public.payroll_v2_validate(jsonb)'::regprocedure);
 if position('payroll_v2_valid_painter_amount(rw)' in definition)=0 then
  patched:=replace(definition,$old$coalesce((rw->>'weekly')::numeric,-1) not between 0 and 999999999 or coalesce((rw#>>'{job,contract}')::numeric,-1) not between 0 and 999999999 or (rw->>'opening')::numeric is null or (rw->>'remaining')::numeric is null or round((rw->>'remaining')::numeric,2)<>round((rw->>'opening')::numeric-(rw->>'weekly')::numeric,2)$old$,'not public.payroll_v2_valid_painter_amount(rw)');
  if patched=definition then raise exception 'Unexpected payroll validator; nothing changed';end if;
  execute patched;
 end if;
 definition:=pg_get_functiondef('public.payroll_v2_check_starting_balances(jsonb,jsonb)'::regprocedure);
 if position('contractPending' in definition)=0 then
  patched:=replace(definition,$old$between 0 and coalesce((j->>'contract')::numeric,-1)$old$,$new$between 0 and (case when j->'contractPending'='true'::jsonb then 999999999 else coalesce((j->>'contract')::numeric,-1) end)$new$);
  if patched=definition then raise exception 'Apply payroll update 083 first';end if;
  execute patched;
 end if;
 definition:=pg_get_functiondef('public.payroll_v2_save(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure);
 if position('payroll_v2_check_pending_contracts(next_state)' in definition)=0 then
  patched:=replace(definition,'perform payroll_v2_validate(next_state);',E'perform payroll_v2_validate(next_state);\n perform payroll_v2_check_pending_contracts(next_state);');
  if patched=definition then raise exception 'Unexpected payroll save definition; nothing changed';end if;
  execute patched;
 end if;
end $patch$;
revoke all on function public.payroll_v2_valid_painter_amount(jsonb) from public,anon,authenticated;
revoke all on function public.payroll_v2_check_pending_contracts(jsonb) from public,anon,authenticated;
commit;
