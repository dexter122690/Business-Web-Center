-- Inventory by business and branch.
-- Eligible expense lines become stock-in automatically. Stock-out is tied to an invoice/unit.

begin;

create table if not exists public.inventory_stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  movement_type text not null check (movement_type in ('in','out')),
  expense_id uuid references public.expenses(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  item_name text not null,
  category text not null,
  quantity numeric(12,2) not null check (quantity > 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  total_value numeric(14,2) not null default 0 check (total_value >= 0),
  unit_label text,
  reference_label text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (expense_id, movement_type)
);

create index if not exists inventory_movements_branch_idx
  on public.inventory_stock_movements (business_id, branch_id, created_at desc);
create index if not exists inventory_movements_invoice_idx
  on public.inventory_stock_movements (invoice_id, created_at desc);

alter table public.inventory_stock_movements enable row level security;

drop policy if exists inventory_movements_read on public.inventory_stock_movements;
create policy inventory_movements_read on public.inventory_stock_movements
for select to authenticated
using (public.is_platform_admin() or public.is_business_member(business_id));

drop policy if exists inventory_movements_manage on public.inventory_stock_movements;
create policy inventory_movements_manage on public.inventory_stock_movements
for all to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id))
with check (
  (public.is_platform_admin() or public.is_business_manager(business_id))
  and exists (select 1 from public.branches br where br.id=branch_id and br.business_id=business_id and br.is_active)
);

create or replace function public.sync_expense_stock_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.inventory_stock_movements
  where expense_id = new.id and movement_type = 'in';

  if lower(trim(new.category)) in ('parts & materials', 'cost of sales') then
    insert into public.inventory_stock_movements (
      business_id, branch_id, movement_type, expense_id, item_name, category,
      quantity, unit_cost, total_value, reference_label, notes, created_by
    ) values (
      new.business_id, new.branch_id, 'in', new.id, new.description, new.category,
      new.quantity, new.unit_amount, new.quantity * new.unit_amount,
      coalesce(new.receipt_number, new.reference_number, 'Expense stock-in'),
      'Imported automatically from Expenses', new.created_by
    );
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_sync_inventory_stock_in on public.expenses;
create trigger expenses_sync_inventory_stock_in
after insert or update of category, description, quantity, unit_amount, receipt_number, reference_number, branch_id
on public.expenses
for each row execute procedure public.sync_expense_stock_in();

-- Bring eligible existing expense lines into the new stock register once.
insert into public.inventory_stock_movements (
  business_id, branch_id, movement_type, expense_id, item_name, category,
  quantity, unit_cost, total_value, reference_label, notes, created_by
)
select e.business_id, e.branch_id, 'in', e.id, e.description, e.category,
  e.quantity, e.unit_amount, e.quantity * e.unit_amount,
  coalesce(e.receipt_number, e.reference_number, 'Expense stock-in'),
  'Imported automatically from Expenses', e.created_by
from public.expenses e
where lower(trim(e.category)) in ('parts & materials', 'cost of sales')
on conflict (expense_id, movement_type) do nothing;

commit;
