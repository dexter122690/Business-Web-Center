-- Keep an edited expense and its generated cash movement in one transaction.
-- Branch admins with Expenses: Edit may correct the source of payment, while
-- manual cash-record erasure remains owner-only through the existing policy.

begin;

create or replace function public.update_expense_with_cash(
  p_expense_id uuid,
  p_business_id uuid,
  p_branch_id uuid,
  p_expense_date date,
  p_supplier_name text,
  p_receipt_number text,
  p_description text,
  p_category text,
  p_quantity numeric,
  p_unit_amount numeric,
  p_payment_method text,
  p_reference_number text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense public.expenses%rowtype;
  v_source_keys text[];
  v_new_source_key text;
  v_cash_account text;
  v_cash_id uuid;
  v_cash_deleted integer := 0;
  v_cash_saved integer := 0;
  v_total numeric(14,2);
begin
  if p_expense_id is null or p_business_id is null or p_branch_id is null then
    raise exception 'The expense context is incomplete.';
  end if;
  if p_expense_date is null or coalesce(trim(p_description), '') = '' then
    raise exception 'Enter the date and item or service.';
  end if;
  if coalesce(p_quantity, 0) < 1 or coalesce(p_unit_amount, 0) < 0 then
    raise exception 'Quantity and amount are invalid.';
  end if;
  if not public.can_manage_expense_branch(p_business_id, p_branch_id) then
    raise exception 'You do not have permission to edit expenses in this branch.';
  end if;

  select * into v_expense
  from public.expenses
  where id = p_expense_id
    and business_id = p_business_id
    and branch_id = p_branch_id
  for update;

  if not found then
    raise exception 'Expense was not found in the selected branch.';
  end if;
  if v_expense.remarks = 'Manual multi-item receipt entry' then
    raise exception 'This legacy shared receipt must be corrected with a documented cash adjustment.';
  end if;

  v_source_keys := array[
    'expense:' || v_expense.id::text,
    'receipt-line:' || v_expense.id::text,
    'petty-expense:' || v_expense.id::text,
    'cib-expense:' || v_expense.id::text
  ];

  -- Remove only generated Out rows belonging to this expense. This runs with
  -- the caller's identity in audit triggers but safely bypasses the owner-only
  -- manual-erasure policy through this permission-checked function.
  delete from public.cash_transactions
  where business_id = p_business_id
    and branch_id = p_branch_id
    and direction = 'Out'
    and source_key = any(v_source_keys);
  get diagnostics v_cash_deleted = row_count;

  update public.expenses
  set expense_date = p_expense_date,
      supplier_name = nullif(trim(p_supplier_name), ''),
      receipt_number = nullif(trim(p_receipt_number), ''),
      description = trim(p_description),
      category = nullif(trim(p_category), ''),
      quantity = p_quantity,
      unit_amount = p_unit_amount,
      payment_method = nullif(trim(p_payment_method), ''),
      reference_number = nullif(trim(p_reference_number), '')
  where id = p_expense_id
    and business_id = p_business_id
    and branch_id = p_branch_id;

  v_total := round(p_quantity * p_unit_amount, 2);
  if lower(trim(coalesce(p_payment_method, ''))) = 'cib' then
    v_cash_account := 'CIB';
  elsif lower(trim(coalesce(p_payment_method, ''))) = 'petty cash' then
    v_cash_account := 'Petty Cash';
  else
    v_cash_account := null;
  end if;

  if v_cash_account is not null then
    if v_expense.remarks = 'Manual receipt line entry' then
      v_new_source_key := 'receipt-line:' || p_expense_id::text;
    elsif v_expense.remarks = 'Petty Cash expense with receipt' then
      v_new_source_key := 'petty-expense:' || p_expense_id::text;
    elsif v_expense.remarks = 'CIB expense with receipt' then
      v_new_source_key := 'cib-expense:' || p_expense_id::text;
    else
      v_new_source_key := 'expense:' || p_expense_id::text;
    end if;

    select id into v_cash_id
    from public.cash_transactions
    where business_id = p_business_id
      and branch_id = p_branch_id
      and source_key = v_new_source_key
    for update;

    if v_cash_id is null then
      insert into public.cash_transactions (
        business_id, branch_id, cash_account, direction, amount,
        transaction_date, source_key, reference_number, notes, created_by
      ) values (
        p_business_id, p_branch_id, v_cash_account, 'Out', v_total,
        p_expense_date, v_new_source_key,
        coalesce(nullif(trim(p_reference_number), ''), nullif(trim(p_receipt_number), '')),
        trim(p_description), auth.uid()
      );
    else
      update public.cash_transactions
      set cash_account = v_cash_account,
          direction = 'Out',
          amount = v_total,
          transaction_date = p_expense_date,
          reference_number = coalesce(nullif(trim(p_reference_number), ''), nullif(trim(p_receipt_number), '')),
          notes = trim(p_description)
      where id = v_cash_id;
    end if;
    v_cash_saved := 1;
  end if;

  return jsonb_build_object(
    'expense_id', p_expense_id,
    'cash_deleted', v_cash_deleted,
    'cash_saved', v_cash_saved,
    'cash_account', v_cash_account
  );
end;
$$;

revoke all on function public.update_expense_with_cash(
  uuid, uuid, uuid, date, text, text, text, text, numeric, numeric, text, text
) from public;
grant execute on function public.update_expense_with_cash(
  uuid, uuid, uuid, date, text, text, text, text, numeric, numeric, text, text
) to authenticated;

commit;
