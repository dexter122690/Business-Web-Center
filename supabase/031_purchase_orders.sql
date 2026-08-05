-- Purchase Orders: branch-specific supplier orders.
-- Receiving an approved PO creates Expense lines; the existing inventory trigger adds eligible items to stock.

begin;

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  po_number text not null,
  supplier_name text not null,
  order_date date not null default current_date,
  expected_date date,
  payment_method text not null default 'Authorized Manager',
  notes text,
  status text not null default 'Draft' check (status in ('Draft','Approved','Received')),
  received_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, branch_id, po_number)
);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  category text not null default 'Parts & Materials',
  description text not null,
  quantity numeric(12,2) not null check (quantity > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists purchase_orders_branch_date_idx on public.purchase_orders (business_id, branch_id, order_date desc);
create index if not exists purchase_order_items_order_idx on public.purchase_order_items (purchase_order_id, sort_order);

drop trigger if exists set_purchase_orders_updated_at on public.purchase_orders;
create trigger set_purchase_orders_updated_at before update on public.purchase_orders
for each row execute procedure public.set_updated_at();

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

drop policy if exists purchase_orders_read on public.purchase_orders;
create policy purchase_orders_read on public.purchase_orders for select to authenticated
using (public.is_platform_admin() or public.is_business_member(business_id));

drop policy if exists purchase_orders_manage on public.purchase_orders;
create policy purchase_orders_manage on public.purchase_orders for all to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id))
with check (
  (public.is_platform_admin() or public.is_business_manager(business_id))
  and exists (select 1 from public.branches br where br.id=branch_id and br.business_id=business_id and br.is_active)
);

drop policy if exists purchase_order_items_read on public.purchase_order_items;
create policy purchase_order_items_read on public.purchase_order_items for select to authenticated
using (exists (select 1 from public.purchase_orders po where po.id=purchase_order_id and (public.is_platform_admin() or public.is_business_member(po.business_id))));

drop policy if exists purchase_order_items_manage on public.purchase_order_items;
create policy purchase_order_items_manage on public.purchase_order_items for all to authenticated
using (exists (select 1 from public.purchase_orders po where po.id=purchase_order_id and (public.is_platform_admin() or public.is_business_manager(po.business_id))))
with check (exists (select 1 from public.purchase_orders po where po.id=purchase_order_id and (public.is_platform_admin() or public.is_business_manager(po.business_id))));

commit;
