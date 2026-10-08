-- Reliable owner-only expense voiding.  This replaces separate browser-side
-- deletes with one database transaction: expense, linked cash movement, and
-- audit history either all succeed or none of them change.

begin;

drop trigger if exists audit_cash_transactions on public.cash_transactions;
create trigger audit_cash_transactions
after insert or update or delete on public.cash_transactions
for each row execute procedure public.capture_business_audit();

create or replace function public.void_expense_with_cash(
  p_expense_id uuid,
  p_business_id uuid,
  p_branch_id uuid,
  p_cash_action text,
  p_keep_cash_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense public.expenses%rowtype;
  v_source_key text;
  v_cash_count integer := 0;
  v_action text := upper(trim(coalesce(p_cash_action, '')));
  v_remaining_cash_total numeric(14,2) := 0;
  v_before_cash_total numeric(14,2) := 0;
  v_removed_cash_amount numeric(14,2) := 0;
  v_remaining_cash_accounts integer := 0;
  v_remaining_cash_account text;
  v_cash public.cash_transactions%rowtype;
begin
  select * into v_expense
  from public.expenses
  where id = p_expense_id
    and business_id = p_business_id
    and branch_id = p_branch_id
  for update;

  if not found then
    raise exception 'Expense was not found in the selected branch.';
  end if;

  if not public.is_platform_admin() and not public.is_business_owner(v_expense.business_id) then
    raise exception 'Only the business owner can void an expense.';
  end if;

  if v_expense.invoice_writeoff_id is not null then
    raise exception 'Protected audit records cannot be voided.';
  end if;

  if v_action not in ('REVERSE', 'KEEP') then
    raise exception 'Choose whether to reverse the linked cash or keep it spent.';
  end if;

  if v_action = 'KEEP' and coalesce(trim(p_keep_cash_reason), '') = '' then
    raise exception 'Enter why the cash remains spent.';
  end if;

  if v_expense.remarks = 'Manual multi-item receipt entry' then
    v_source_key := 'receipt:' || coalesce(v_expense.supplier_name, '') || '|' || coalesce(v_expense.receipt_number, '') || '|' || v_expense.expense_date::text;
  elsif v_expense.remarks = 'Manual receipt line entry' then
    v_source_key := 'receipt-line:' || v_expense.id::text;
  elsif v_expense.remarks = 'Petty Cash expense with receipt' then
    v_source_key := 'petty-expense:' || v_expense.id::text;
  elsif v_expense.remarks = 'CIB expense with receipt' then
    v_source_key := 'cib-expense:' || v_expense.id::text;
  else
    v_source_key := 'expense:' || v_expense.id::text;
  end if;

  if v_action = 'REVERSE' then
    if v_expense.remarks = 'Manual multi-item receipt entry' then
      select
        count(distinct case lower(trim(coalesce(payment_method, '')))
          when 'cib' then 'CIB'
          when 'petty cash' then 'Petty Cash'
        end),
        max(case lower(trim(coalesce(payment_method, '')))
          when 'cib' then 'CIB'
          when 'petty cash' then 'Petty Cash'
        end),
        coalesce(sum(case when lower(trim(coalesce(payment_method, ''))) in ('cib', 'petty cash') then quantity * unit_amount else 0 end), 0)
      into v_remaining_cash_accounts, v_remaining_cash_account, v_remaining_cash_total
      from public.expenses
      where business_id = v_expense.business_id
        and branch_id = v_expense.branch_id
        and supplier_name is not distinct from v_expense.supplier_name
        and receipt_number is not distinct from v_expense.receipt_number
        and expense_date = v_expense.expense_date
        and remarks = 'Manual multi-item receipt entry'
        and id <> v_expense.id;

      if v_remaining_cash_accounts > 1 then
        raise exception 'This legacy receipt uses more than one cash account. It must be corrected with a documented adjustment.';
      end if;

      if lower(trim(coalesce(v_expense.payment_method, ''))) in ('cib', 'petty cash') then
        v_removed_cash_amount := v_expense.quantity * v_expense.unit_amount;
      end if;
      v_before_cash_total := v_remaining_cash_total + v_removed_cash_amount;

      select * into v_cash
      from public.cash_transactions
      where business_id = v_expense.business_id
        and branch_id = v_expense.branch_id
        and source_key = v_source_key
      for update;

      if found then
        if v_cash.direction <> 'Out'
          or v_cash.transaction_date <> v_expense.expense_date
          or v_cash.amount <> v_before_cash_total
          or (v_remaining_cash_total > 0 and v_cash.cash_account <> v_remaining_cash_account) then
          raise exception 'The shared cash record no longer matches this receipt. Use a documented cash adjustment before voiding this line.';
        end if;
        if v_remaining_cash_total = 0 then
          delete from public.cash_transactions where id = v_cash.id;
        else
          update public.cash_transactions set amount = v_remaining_cash_total where id = v_cash.id;
        end if;
        get diagnostics v_cash_count = row_count;
      elsif v_before_cash_total > 0 then
        raise exception 'The shared cash record is missing. Use a documented cash adjustment before voiding this line.';
      end if;
    else
      delete from public.cash_transactions
      where business_id = v_expense.business_id
        and branch_id = v_expense.branch_id
        and source_key = v_source_key;
      get diagnostics v_cash_count = row_count;
    end if;
  else
    update public.cash_transactions
    set notes = left(coalesce(notes || ' | ', '') || 'Expense voided; cash retained — ' || trim(p_keep_cash_reason), 500)
    where business_id = v_expense.business_id
      and branch_id = v_expense.branch_id
      and source_key = v_source_key;
    get diagnostics v_cash_count = row_count;
  end if;

  delete from public.expenses
  where id = v_expense.id
    and business_id = v_expense.business_id
    and branch_id = v_expense.branch_id;

  return jsonb_build_object(
    'voided_expense_id', v_expense.id,
    'cash_action', v_action,
    'cash_records_affected', v_cash_count
  );
end;
$$;

revoke all on function public.void_expense_with_cash(uuid, uuid, uuid, text, text) from public;
grant execute on function public.void_expense_with_cash(uuid, uuid, uuid, text, text) to authenticated;

commit;
