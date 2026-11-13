-- Authorized corrections for an incorrect invoice amount received.
-- This keeps legacy header-only payments traceable and keeps CIB in sync.
-- Run this after 071_update_invoice_transaction.sql.

begin;

create or replace function public.correct_invoice_payment(
  p_invoice_id uuid,
  p_branch_id uuid,
  p_amount numeric,
  p_payment_id uuid default null,
  p_payment_date date default null,
  p_payment_method text default null,
  p_reference_number text default null,
  p_notes text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_payment public.invoice_payments%rowtype;
  v_before_paid numeric(14,2) := 0;
  v_history_paid numeric(14,2) := 0;
  v_legacy_paid numeric(14,2) := 0;
  v_after_history_paid numeric(14,2) := 0;
  v_after_paid numeric(14,2) := 0;
  v_amount numeric(14,2);
  v_status text;
  v_method text;
  v_date date;
  v_reference text;
  v_notes text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to correct an invoice payment.';
  end if;

  if not public.is_platform_admin()
     and not public.is_business_manager(
       (select business_id from public.invoices where id = p_invoice_id)
     ) then
    raise exception 'Only an authorized manager or owner can correct an invoice payment.';
  end if;

  if p_amount is null then
    raise exception 'Enter the corrected amount received.';
  end if;
  begin
    v_amount := round(p_amount, 2);
  exception when numeric_value_out_of_range then
    raise exception 'The corrected amount is invalid.';
  end;
  if v_amount < 0 then
    raise exception 'The corrected amount cannot be negative.';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Enter a reason for the payment correction.';
  end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id
    and branch_id = p_branch_id
  for update;

  if not found then
    raise exception 'Invoice was not found in the selected branch.';
  end if;
  if not public.can_manage_invoice_branch(v_invoice.business_id, p_branch_id) then
    raise exception 'You do not have permission to correct payments in this branch.';
  end if;
  if exists (
    select 1 from public.cash_collections collection
    where collection.invoice_id = v_invoice.id
      and collection.status = 'Remitted'
  ) then
    raise exception 'This invoice has already been remitted. Record a separate correcting transaction instead.';
  end if;

  v_before_paid := round(coalesce(v_invoice.amount_paid, 0), 2);
  select round(coalesce(sum(amount), 0), 2) into v_history_paid
  from public.invoice_payments
  where invoice_id = v_invoice.id
    and business_id = v_invoice.business_id
    and branch_id = p_branch_id;
  v_legacy_paid := greatest(v_before_paid - v_history_paid, 0);

  if p_payment_id is null then
    -- Header-only legacy payments are converted into a normal history row.
    if v_amount < v_history_paid then
      raise exception 'The corrected total cannot be lower than the existing payment history of PHP %.', to_char(v_history_paid, 'FM999999999990.00');
    end if;
    v_after_history_paid := v_history_paid;
    if v_amount > v_history_paid then
      v_date := coalesce(p_payment_date, v_invoice.invoice_date, current_date);
      v_method := nullif(trim(coalesce(p_payment_method, '')), '');
      if v_method is null then
        raise exception 'Choose the payment method for the corrected legacy amount.';
      end if;
      v_reference := nullif(trim(coalesce(p_reference_number, '')), '');
      v_notes := nullif(trim(coalesce(p_notes, '')), '');
      insert into public.invoice_payments (
        invoice_id, business_id, branch_id, payment_date, amount,
        payment_method, reference_number, notes, received_by, created_by
      ) values (
        v_invoice.id, v_invoice.business_id, p_branch_id, v_date,
        v_amount - v_history_paid, v_method,
        coalesce(v_reference, 'Legacy recorded payment'),
        coalesce(v_notes, 'Created while correcting the legacy amount paid.'),
        v_invoice.assigned_admin, auth.uid()
      );
      v_after_history_paid := v_amount;
    end if;
    v_after_paid := v_after_history_paid;
  else
    select * into v_payment
    from public.invoice_payments
    where id = p_payment_id
      and invoice_id = v_invoice.id
      and business_id = v_invoice.business_id
      and branch_id = p_branch_id
    for update;

    if not found then
      raise exception 'The selected payment record was not found for this invoice.';
    end if;
    if v_amount = 0 then
      delete from public.invoice_payments where id = v_payment.id;
    else
      update public.invoice_payments
      set amount = v_amount,
          payment_date = coalesce(p_payment_date, v_payment.payment_date),
          payment_method = coalesce(nullif(trim(coalesce(p_payment_method, '')), ''), v_payment.payment_method),
          reference_number = nullif(trim(coalesce(p_reference_number, '')), ''),
          notes = nullif(trim(coalesce(p_notes, '')), '')
      where id = v_payment.id;
    end if;
    select round(coalesce(sum(amount), 0), 2) into v_after_history_paid
    from public.invoice_payments
    where invoice_id = v_invoice.id
      and business_id = v_invoice.business_id
      and branch_id = p_branch_id;
    v_after_paid := v_legacy_paid + v_after_history_paid;
  end if;

  if v_after_paid > round(coalesce(v_invoice.total_amount, 0), 2) then
    raise exception 'The corrected amount cannot be higher than the invoice total of PHP %.', to_char(v_invoice.total_amount, 'FM999999999990.00');
  end if;

  select coalesce(sum(amount), 0) into v_after_history_paid
  from public.invoice_balance_writeoffs
  where invoice_id = v_invoice.id;
  v_status := case
    when v_after_history_paid > 0 then 'Closed - unremitted collection'
    when v_after_paid >= v_invoice.total_amount then 'Paid'
    when v_after_paid > 0 then 'Partially paid'
    else 'Pending'
  end;

  update public.invoices
  set amount_paid = v_after_paid,
      status = v_status,
      payment_method = case
        when p_payment_id is null and nullif(trim(coalesce(p_payment_method, '')), '') is not null
          then trim(p_payment_method)
        else payment_method
      end
  where id = v_invoice.id
    and business_id = v_invoice.business_id
    and branch_id = p_branch_id;

  -- Rebuild only this invoice's generated CIB rows from the corrected history.
  perform public.sync_invoice_payment_cash(v_invoice.id, p_branch_id);

  insert into public.audit_logs (
    business_id, branch_id, actor_id, action, entity_type, entity_id, details
  ) values (
    v_invoice.business_id, p_branch_id, auth.uid(), 'corrected', 'invoice_payment',
    v_invoice.id::text,
    jsonb_build_object(
      'payment_id', p_payment_id,
      'before_amount_paid', v_before_paid,
      'after_amount_paid', v_after_paid,
      'reason', trim(p_reason),
      'legacy_amount_before', v_legacy_paid
    )
  );

  return jsonb_build_object(
    'ok', true,
    'invoice_id', v_invoice.id,
    'amount_paid', v_after_paid,
    'status', v_status
  );
end;
$$;

grant execute on function public.correct_invoice_payment(uuid, uuid, numeric, uuid, date, text, text, text, text) to authenticated;

commit;
