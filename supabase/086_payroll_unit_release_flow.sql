-- Release controls belong to the main worksheet. Carried balances are not new pay.
-- No existing records, grants, or other modules are changed by this migration.
begin;
create or replace function public.payroll_v2_check_unit_release_flow(s jsonb) returns void
language plpgsql set search_path=public as $$
declare sh jsonb; rw jsonb; j jsonb; start_date date;
begin
 for sh in select * from jsonb_array_elements(s->'painterTestSheets') loop
  for rw in select * from jsonb_array_elements(sh#>'{snapshot,rows}') loop
   j:=rw->'job';
   if j ? 'releasePayrollStart' then
    start_date:=(j->>'releasePayrollStart')::date;
    if start_date is null or extract(dow from start_date)<>6
      or j->>'retentionStatus' is distinct from 'retained'
      or (j->>'unitReleasedOn')::date is null
      or start_date>(sh#>>'{period,start}')::date
      or (start_date<(sh#>>'{period,start}')::date and (rw->>'weekly')::numeric<>0)
    then raise exception 'Invalid released-unit carry-forward';end if;
   end if;
  end loop;
 end loop;
end $$;
do $patch$
declare definition text; patched text;
begin
 definition:=pg_get_functiondef('public.payroll_v2_save(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure);
 if position('payroll_v2_check_unit_release_flow(next_state)' in definition)=0 then
  patched:=replace(definition,'perform payroll_v2_validate(next_state);',E'perform payroll_v2_validate(next_state);\n perform payroll_v2_check_unit_release_flow(next_state);');
  if patched=definition then raise exception 'Unexpected payroll save definition; nothing changed';end if;
  execute patched;
 end if;
end $patch$;
revoke all on function public.payroll_v2_check_unit_release_flow(jsonb) from public,anon,authenticated;
commit;
