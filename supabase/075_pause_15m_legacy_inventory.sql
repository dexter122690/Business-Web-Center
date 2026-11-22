-- Pause only the OLD/HIDDEN Inventory for 15M Autocare Services (all branches).
-- The visible Inventory Tracker, Expenses, invoices, payroll, permissions helpers,
-- and all existing rows are intentionally untouched. No backfill or data cleanup.
begin;
set local search_path = public;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
declare
  current_trigger text;
  original_trigger constant text := 'CREATE TRIGGER expenses_sync_inventory_stock_in AFTER INSERT OR UPDATE OF category, description, quantity, unit_amount, receipt_number, reference_number, branch_id ON public.expenses FOR EACH ROW EXECUTE FUNCTION sync_expense_stock_in()';
  paused_trigger constant text := 'CREATE TRIGGER expenses_sync_inventory_stock_in AFTER INSERT OR UPDATE OF category, description, quantity, unit_amount, receipt_number, reference_number, branch_id ON public.expenses FOR EACH ROW WHEN ((new.business_id <> ''ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875''::uuid)) EXECUTE FUNCTION sync_expense_stock_in()';
begin
  if not exists (
    select 1 from public.businesses
    where id = 'ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875'
      and name = '15M Autocare Services'
  ) then
    raise exception 'Expected 15M business was not found. No changes applied.';
  end if;
  select pg_get_triggerdef(oid) into current_trigger from pg_trigger
  where tgrelid = 'public.expenses'::regclass
    and tgname = 'expenses_sync_inventory_stock_in' and tgenabled = 'O';
  if current_trigger is null or current_trigger not in (original_trigger, paused_trigger) then
    raise exception 'Expense inventory trigger changed; inspect it before pausing. No changes applied.';
  end if;
end;
$preflight$;

-- Skip the entire old sync, including its delete/reinsert on expense edits.
-- Other businesses retain the original behavior. All other expense triggers stay on.
create or replace trigger expenses_sync_inventory_stock_in
after insert or update of category, description, quantity, unit_amount,
  receipt_number, reference_number, branch_id on public.expenses
for each row
when (new.business_id <> 'ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875'::uuid)
execute function public.sync_expense_stock_in();

-- Block old manual stock/count writes even from an already-open/stale browser.
-- These restrictive policies supplement, not replace, existing access rules.
-- SELECT remains available; PostgreSQL FK cleanup from source records is unchanged.
do $policies$
declare
  target_table text;
  operation text;
  policy_name text;
  predicate constant text := '(business_id <> ''ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875''::uuid)';
  clauses text;
begin
  foreach target_table in array array['inventory_stock_movements', 'inventory_opening_cutovers', 'inventory_opening_counts'] loop
    if not exists (select 1 from pg_class where oid = format('public.%I', target_table)::regclass and relrowsecurity) then
      raise exception 'RLS is not enabled for %. No changes applied.', target_table;
    end if;
    foreach operation in array array['INSERT', 'UPDATE', 'DELETE'] loop
      policy_name := 'inventory_15m_paused_' || lower(operation);
      if exists (select 1 from pg_policies where schemaname = 'public' and tablename = target_table and policyname = policy_name) then
        if not exists (
          select 1 from pg_policies where schemaname = 'public' and tablename = target_table
            and policyname = policy_name and permissive = 'RESTRICTIVE' and cmd = operation
            and roles = array['authenticated']::name[]
            and qual is not distinct from case when operation <> 'INSERT' then predicate end
            and with_check is not distinct from case when operation <> 'DELETE' then predicate end
        ) then
          raise exception 'Unexpected existing pause policy on %. No changes applied.', target_table;
        end if;
      else
        clauses := case operation
          when 'INSERT' then 'with check ' || predicate
          when 'UPDATE' then 'using ' || predicate || ' with check ' || predicate
          when 'DELETE' then 'using ' || predicate
        end;
        execute format('create policy %I on public.%I as restrictive for %s to authenticated %s',
          policy_name, target_table, operation, clauses);
      end if;
    end loop;
  end loop;
end;
$policies$;

commit;
