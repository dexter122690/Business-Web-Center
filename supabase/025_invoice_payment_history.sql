-- Installment payment history for invoices.
-- Run this after 024_cash_controls.sql.

begin;

create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  payment_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null,
  reference_number text,
  notes text,
  received_by text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists invoice_payments_invoice_date_idx
  on public.invoice_payments (invoice_id, payment_date desc, created_at desc);
create index if not exists invoice_payments_branch_date_idx
  on public.invoice_payments (branch_id, payment_date desc);

alter table public.invoice_payments enable row level security;

drop policy if exists invoice_payments_read on public.invoice_payments;
create policy invoice_payments_read on public.invoice_payments
for select to authenticated
using (public.is_platform_admin() or public.is_business_member(business_id));

drop policy if exists invoice_payments_insert on public.invoice_payments;
create policy invoice_payments_insert on public.invoice_payments
for insert to authenticated
with check (
  (public.is_platform_admin() or public.is_business_manager(business_id))
  and created_by = auth.uid()
  and exists (
    select 1 from public.branches br
    where br.id = branch_id and br.business_id = business_id and br.is_active
  )
);

drop policy if exists invoice_payments_update on public.invoice_payments;
create policy invoice_payments_update on public.invoice_payments
for update to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id))
with check (public.is_platform_admin() or public.is_business_manager(business_id));

drop policy if exists invoice_payments_delete on public.invoice_payments;
create policy invoice_payments_delete on public.invoice_payments
for delete to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id));

commit;
