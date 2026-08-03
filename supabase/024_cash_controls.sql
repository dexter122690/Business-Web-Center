-- Branch cash controls for CIB and Petty Cash.
-- Run this after 023_public_appointment_links.sql.

begin;

create table if not exists public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  cash_account text not null check (cash_account in ('CIB', 'Petty Cash')),
  direction text not null check (direction in ('In', 'Out')),
  amount numeric(14,2) not null check (amount > 0),
  transaction_date date not null default current_date,
  source_key text,
  reference_number text,
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create unique index if not exists cash_transactions_branch_source_key_idx
  on public.cash_transactions (branch_id, source_key)
  where source_key is not null;

create index if not exists cash_transactions_branch_date_idx
  on public.cash_transactions (branch_id, transaction_date desc, created_at desc);

alter table public.cash_transactions enable row level security;

drop policy if exists cash_transactions_read on public.cash_transactions;
create policy cash_transactions_read on public.cash_transactions
for select to authenticated
using (public.is_platform_admin() or public.is_business_member(business_id));

drop policy if exists cash_transactions_insert on public.cash_transactions;
create policy cash_transactions_insert on public.cash_transactions
for insert to authenticated
with check (
  (public.is_platform_admin() or public.is_business_manager(business_id))
  and created_by = auth.uid()
);

drop policy if exists cash_transactions_delete on public.cash_transactions;
create policy cash_transactions_delete on public.cash_transactions
for delete to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id));

commit;
