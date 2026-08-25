-- Owner-only erase permission for manual CIB and Petty Cash corrections.
-- Invoice and expense generated cash records are still corrected through their
-- source record in the app, so the linked invoice/expense stays accurate.

begin;

drop policy if exists cash_transactions_delete on public.cash_transactions;
create policy cash_transactions_delete on public.cash_transactions
for delete to authenticated
using (
  public.is_platform_admin()
  or public.is_business_owner(business_id)
);

commit;
