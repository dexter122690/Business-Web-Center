-- Online expense register for Business Web Center.
-- Run after schema.sql, 002_signup_workflow.sql, and 003_invoices.sql.

begin;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  expense_date date not null,
  supplier_name text,
  receipt_number text,
  category text not null,
  description text not null,
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit_amount numeric(14,2) not null check (unit_amount >= 0),
  payment_method text,
  reference_number text,
  remarks text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expenses_business_date_idx
  on public.expenses (business_id, expense_date desc);

drop trigger if exists set_expenses_updated_at on public.expenses;
create trigger set_expenses_updated_at
before update on public.expenses
for each row execute procedure public.set_updated_at();

alter table public.expenses enable row level security;

drop policy if exists expenses_read on public.expenses;
create policy expenses_read on public.expenses
for select to authenticated
using (public.is_platform_admin() or public.is_business_member(business_id));

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
for insert to authenticated
with check (
  (public.is_platform_admin() or public.is_business_manager(business_id))
  and created_by = auth.uid()
);

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses
for update to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id))
with check (public.is_platform_admin() or public.is_business_manager(business_id));

drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete on public.expenses
for delete to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id));

commit;
