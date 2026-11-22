-- Pause the OLD payroll for 15M only, preserving every historical/shared row.
-- Invoice/PMS worker-name reads and Repaint Monitoring job references stay intact.
-- This does not install or connect the separate new payroll draft.
begin;
set local search_path = public;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
begin
  if not exists (select 1 from public.businesses
    where id='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875' and name='15M Autocare Services')
    or not exists (select 1 from public.business_management
      where business_id='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875') then
    raise exception 'Expected 15M business/settings are missing. No changes applied.';
  end if;
  -- RLS does not constrain SECURITY DEFINER writers. Stop for an unreviewed path.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
      and p.prosrc ~* '(insert into|update|delete from)[[:space:]]+(public[.])?(payroll_|payslips|branch_time_clock_links)'
      and not (p.proname='submit_public_time_clock_punch'
        and to_regclass('public.branch_time_clock_links') is not null
        and p.prosrc ~* 'link[.]enabled[[:space:]]*=[[:space:]]*true')) then
    raise exception 'Unreviewed payroll writer exists. Inspect it before pausing.';
  end if;
end;
$preflight$;

-- Keep billing, notes, all other feature flags, and all business records intact.
update public.business_management
set enabled_features=jsonb_set(enabled_features,'{payroll}','false'::jsonb,true)
where business_id='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875'
  and enabled_features->'payroll' is distinct from 'false'::jsonb;

do $pause$
declare
  target_table text;
  operation text;
  policy_name text;
  predicate constant text := '(business_id <> ''ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875''::uuid)';
  clauses text;
begin
  -- Optional: never install an unused public clock just to pause payroll.
  if to_regclass('public.branch_time_clock_links') is not null then
    execute 'update public.branch_time_clock_links set enabled=false
      where business_id=''ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875'' and enabled=true';
  end if;
  foreach target_table in array array[
    'payroll_workers','payroll_attendance','payroll_vehicle_jobs','payroll_job_payments',
    'payroll_obligations','payroll_obligation_payments','payroll_periods','payslips',
    'payroll_adjustments','branch_time_clock_links'
  ] loop
    if target_table='branch_time_clock_links' and to_regclass('public.branch_time_clock_links') is null then
      continue;
    end if;
    if not exists (select 1 from pg_class where oid=format('public.%I',target_table)::regclass and relrowsecurity) then
      raise exception 'RLS is not enabled for %. No changes applied.',target_table;
    end if;
    foreach operation in array array['INSERT','UPDATE','DELETE'] loop
      policy_name:='payroll_15m_paused_'||lower(operation);
      if exists (select 1 from pg_policies where schemaname='public' and tablename=target_table and policyname=policy_name) then
        if not exists (select 1 from pg_policies
          where schemaname='public' and tablename=target_table and policyname=policy_name
            and permissive='RESTRICTIVE' and cmd=operation and roles=array['authenticated']::name[]
            and qual is not distinct from case when operation<>'INSERT' then predicate end
            and with_check is not distinct from case when operation<>'DELETE' then predicate end) then
          raise exception 'Unexpected pause policy on %. No changes applied.',target_table;
        end if;
      else
        clauses:=case operation
          when 'INSERT' then 'with check '||predicate
          when 'UPDATE' then 'using '||predicate||' with check '||predicate
          when 'DELETE' then 'using '||predicate end;
        execute format('create policy %I on public.%I as restrictive for %s to authenticated %s',
          policy_name,target_table,operation,clauses);
      end if;
    end loop;
  end loop;
end;
$pause$;

-- SELECT rules, shared permission helpers, foreign keys, and audit triggers stay on.
-- Source-record FK cleanup (e.g. deleting an invoice) retains its normal behavior.
commit;
