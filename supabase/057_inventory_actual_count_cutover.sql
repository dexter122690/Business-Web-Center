-- Start reliable stock control from a physical count without deleting older
-- Expenses or inventory history. Each branch receives one opening baseline.

begin;

create table if not exists public.inventory_opening_cutovers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  cutover_at timestamptz not null default now(),
  finalized_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id, branch_id)
);

create table if not exists public.inventory_opening_counts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  sku text not null,
  item_name text not null,
  category text not null,
  quantity numeric(12,2) not null check (quantity > 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  notes text,
  counted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, branch_id, sku)
);

create index if not exists inventory_opening_counts_branch_idx
  on public.inventory_opening_counts (business_id, branch_id, item_name);

alter table public.inventory_opening_cutovers enable row level security;
alter table public.inventory_opening_counts enable row level security;

drop policy if exists inventory_opening_cutovers_read on public.inventory_opening_cutovers;
create policy inventory_opening_cutovers_read on public.inventory_opening_cutovers
for select to authenticated
using (public.is_platform_admin() or public.is_business_member(business_id));

drop policy if exists inventory_opening_cutovers_owner_write on public.inventory_opening_cutovers;
create policy inventory_opening_cutovers_owner_write on public.inventory_opening_cutovers
for all to authenticated
using (public.is_platform_admin() or public.is_business_owner(business_id))
with check (public.is_platform_admin() or public.is_business_owner(business_id));

drop policy if exists inventory_opening_counts_read on public.inventory_opening_counts;
create policy inventory_opening_counts_read on public.inventory_opening_counts
for select to authenticated
using (public.is_platform_admin() or public.is_business_member(business_id));

drop policy if exists inventory_opening_counts_manage on public.inventory_opening_counts;
create policy inventory_opening_counts_manage on public.inventory_opening_counts
for all to authenticated
using (public.can_manage_inventory_branch(business_id, branch_id))
with check (public.can_manage_inventory_branch(business_id, branch_id));

create or replace function public.set_inventory_opening_count_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists inventory_opening_counts_updated_at on public.inventory_opening_counts;
create trigger inventory_opening_counts_updated_at
before update on public.inventory_opening_counts
for each row execute procedure public.set_inventory_opening_count_updated_at();

commit;
