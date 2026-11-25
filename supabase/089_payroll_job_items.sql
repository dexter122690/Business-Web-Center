-- Itemized job amounts are per worksheet/week, not automatic repeat payments.
-- Validation only: existing payroll entries, PDFs, access and other tabs stay unchanged.
begin;
create or replace function public.payroll_v2_check_job_items(old_state jsonb,new_state jsonb) returns void
language plpgsql set search_path=public as $$
declare sh jsonb; rw jsonb; item jsonb; items jsonb; total numeric; description text;
begin
 for sh in select * from jsonb_array_elements(new_state->'painterTestSheets') loop
  for rw in select * from jsonb_array_elements(sh#>'{snapshot,rows}') loop
   if not (rw ? 'workItems') then continue;end if;
   items:=rw->'workItems';
   if jsonb_typeof(items) is distinct from 'array' then raise exception 'Invalid itemized job lines';end if;
   if jsonb_array_length(items)>30 then raise exception 'Use up to 30 job lines per unit';end if;
   for item in select * from jsonb_array_elements(items) loop
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'description') is distinct from 'string' or jsonb_typeof(item->'amount') is distinct from 'number'
     then raise exception 'Each job needs a description and a numeric amount';end if;
    if length(btrim(item->>'description'))=0 or length(item->>'description')>1000 or item->>'description'<>btrim(item->>'description')
     or (item->>'amount')::numeric not between 0 and 999999999 or (item->>'amount')::numeric<>round((item->>'amount')::numeric,2)
     or item-'description'-'amount'<>'{}'::jsonb then raise exception 'Invalid job description or amount';end if;
   end loop;
   select coalesce(sum((x->>'amount')::numeric),0),coalesce(string_agg(x->>'description',E'\n' order by n),'') into total,description from jsonb_array_elements(items) with ordinality a(x,n);
   if round((rw->>'weekly')::numeric,2) is distinct from round(total,2) or rw#>>'{job,work}' is distinct from description then raise exception 'Itemized job amounts must add up to Amount this week';end if;
  end loop;
 end loop;
 -- Older clients must not silently strip itemization while overwriting a working week.
 if exists(select 1 from payroll_v2_ledger_rows(old_state) o join payroll_v2_ledger_rows(new_state) n
   on n.employee=o.employee and n.job_id=o.job_id and n.week=o.week and n.week_end=o.week_end
   where o.rw ? 'workItems' and not(n.rw ? 'workItems')) then raise exception 'Keep the itemized job lines. Reload the updated payroll before saving.';end if;
end $$;
do $patch$
declare definition text; patched text;
begin
 definition:=pg_get_functiondef('public.payroll_v2_save(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure);
 if position('payroll_v2_check_cross_date(old,next_state)' in definition)=0 then raise exception 'Apply payroll update 088 first';end if;
 if position('payroll_v2_check_job_items(old,next_state)' in definition)=0 then
  patched:=replace(definition,'perform payroll_v2_validate(next_state);',E'perform payroll_v2_validate(next_state);\n perform payroll_v2_check_job_items(old,next_state);');
  if patched=definition then raise exception 'Unexpected payroll save definition; nothing changed';end if;execute patched;
 end if;
end $patch$;
revoke all on function public.payroll_v2_check_job_items(jsonb,jsonb) from public,anon,authenticated;
commit;
