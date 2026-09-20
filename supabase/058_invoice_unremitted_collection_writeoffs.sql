-- Owner-only closure for an invoice balance that was collected by a former
-- employee but was never remitted to the business.  This deliberately does
-- not create an invoice payment or a CIB transaction.

begin;

create table if not exists public.invoice_balance_writeoffs (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null unique references public.invoices(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  writeoff_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  reason text not null check (reason in ('unremitted_collection')),
  notes text not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists invoice_balance_writeoffs_branch_date_idx
  on public.invoice_balance_writeoffs (branch_id, writeoff_date desc);

alter table public.expenses
  add column if not exists invoice_writeoff_id uuid
  references public.invoice_balance_writeoffs(id) on delete restrict;
create unique index if not exists expenses_invoice_writeoff_id_key
  on public.expenses (invoice_writeoff_id)
  where invoice_writeoff_id is not null;

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status in ('Pending', 'Partially paid', 'Paid', 'Closed - unremitted collection'));

alter table public.invoice_balance_writeoffs enable row level security;

drop policy if exists invoice_balance_writeoffs_read on public.invoice_balance_writeoffs;
create policy invoice_balance_writeoffs_read on public.invoice_balance_writeoffs
for select to authenticated
using (public.can_view_invoice_branch(business_id, branch_id));

-- Browser users cannot insert, edit, or erase these records directly.  The
-- RPC below is the only write path and checks that the signed-in user is owner.

-- The linked loss entry is part of the immutable closure audit trail. Normal
-- expense records continue to be editable/deletable under the existing branch
-- permission model, but this particular protected record does not.
drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses
for update to authenticated
using (
  public.can_manage_expense_branch(business_id, branch_id)
  and invoice_writeoff_id is null
)
with check (
  public.can_manage_expense_branch(business_id, branch_id)
  and invoice_writeoff_id is null
);

drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete on public.expenses
for delete to authenticated
using (
  public.can_manage_expense_branch(business_id, branch_id)
  and invoice_writeoff_id is null
);

create or replace function public.close_invoice_as_unremitted_collection(
  p_invoice_id uuid,
  p_branch_id uuid,
  p_writeoff_date date,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_written_off numeric(14,2) := 0;
  v_balance numeric(14,2) := 0;
  v_record public.invoice_balance_writeoffs%rowtype;
begin
  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and branch_id = p_branch_id
  for update;

  if not found then
    raise exception 'Invoice was not found in the selected branch.';
  end if;

  if not public.is_platform_admin() and not public.is_business_owner(v_invoice.business_id) then
    raise exception 'Only the business owner can close an invoice as an unremitted collection.';
  end if;

  if coalesce(trim(p_notes), '') = '' then
    raise exception 'Enter an owner note explaining this unremitted collection.';
  end if;

  select coalesce(sum(amount), 0) into v_written_off
  from public.invoice_balance_writeoffs
  where invoice_id = v_invoice.id;
  v_balance := greatest(0, coalesce(v_invoice.total_amount, 0) - coalesce(v_invoice.amount_paid, 0) - v_written_off);

  if v_balance <= 0.001 then
    raise exception 'This invoice has no remaining balance to close.';
  end if;

  insert into public.invoice_balance_writeoffs (
    invoice_id, business_id, branch_id, writeoff_date, amount, reason, notes, approved_by
  ) values (
    v_invoice.id, v_invoice.business_id, p_branch_id, coalesce(p_writeoff_date, current_date),
    v_balance, 'unremitted_collection', trim(p_notes), auth.uid()
  ) returning * into v_record;

  insert into public.expenses (
    business_id, branch_id, expense_date, supplier_name, receipt_number, category,
    description, quantity, unit_amount, payment_method, reference_number, remarks,
    created_by, invoice_writeoff_id
  ) values (
    v_invoice.business_id, p_branch_id, v_record.writeoff_date, 'Internal loss record', null,
    'Staff Cash Shortage / Unremitted Collection',
    'Unremitted client collection - INV-' || lpad(v_invoice.invoice_number::text, 5, '0'),
    1, v_balance, 'No cash movement', 'INV-' || lpad(v_invoice.invoice_number::text, 5, '0'),
    trim(p_notes), auth.uid(), v_record.id
  );

  update public.invoices
  set status = 'Closed - unremitted collection'
  where id = v_invoice.id;

  return jsonb_build_object(
    'ok', true,
    'invoice_number', v_invoice.invoice_number,
    'amount_closed', v_balance,
    'writeoff_id', v_record.id
  );
end;
$$;

grant execute on function public.close_invoice_as_unremitted_collection(uuid, uuid, date, text) to authenticated;

commit;
