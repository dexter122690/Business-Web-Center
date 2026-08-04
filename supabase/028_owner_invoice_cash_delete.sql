-- Owner-only correction for CIB entries generated from invoice cash payments.
-- This keeps the invoice balance, invoice payment history, CIB, and cash-remittance records consistent.

begin;

create or replace function public.owner_delete_invoice_cash_payments(
  p_invoice_id uuid,
  p_branch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_paid numeric(14,2) := 0;
  v_method text := 'Other';
  v_remitted boolean := false;
begin
  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and branch_id = p_branch_id
  for update;

  if not found then
    raise exception 'Invoice was not found in the selected branch.';
  end if;

  if not public.is_platform_admin() and not exists (
    select 1 from public.business_memberships m
    where m.business_id = v_invoice.business_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'owner'
  ) then
    raise exception 'Only the business owner can delete an invoice cash payment.';
  end if;

  select exists(
    select 1 from public.cash_collections c
    where c.invoice_id = v_invoice.id and c.status = 'Remitted'
  ) into v_remitted;
  if v_remitted then
    raise exception 'This cash payment has already been remitted. Record a correcting transaction instead.';
  end if;

  delete from public.invoice_payments
  where invoice_id = v_invoice.id
    and lower(trim(payment_method)) = 'cash';

  select coalesce(sum(amount),0) into v_paid
  from public.invoice_payments
  where invoice_id = v_invoice.id;

  select payment_method into v_method
  from public.invoice_payments
  where invoice_id = v_invoice.id
  order by payment_date desc, created_at desc
  limit 1;
  v_method := coalesce(v_method, 'Other');

  -- Older invoices may have a cash amount but no detailed payment row yet.
  if v_paid = 0 and lower(trim(coalesce(v_invoice.payment_method,''))) = 'cash' then
    v_method := 'Other';
  end if;

  delete from public.cash_transactions
  where business_id = v_invoice.business_id
    and branch_id = p_branch_id
    and source_key = 'invoice-cash:' || v_invoice.id::text;

  update public.invoices
  set amount_paid = v_paid,
      payment_method = v_method,
      status = case
        when v_paid >= total_amount then 'Paid'
        when v_paid > 0 then 'Partially paid'
        else 'Pending'
      end
  where id = v_invoice.id;

  return jsonb_build_object('ok', true, 'amount_paid', v_paid);
end;
$$;

grant execute on function public.owner_delete_invoice_cash_payments(uuid, uuid) to authenticated;

commit;
