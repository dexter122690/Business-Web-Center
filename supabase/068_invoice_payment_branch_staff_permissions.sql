-- Align invoice payment history with the branch-level invoice permissions.
-- Staff/Admin users with Invoices: Edit may record payments only in their assigned branch.

begin;

drop policy if exists invoice_payments_read on public.invoice_payments;
create policy invoice_payments_read on public.invoice_payments
for select to authenticated
using (public.can_view_invoice_branch(business_id, branch_id));

drop policy if exists invoice_payments_insert on public.invoice_payments;
create policy invoice_payments_insert on public.invoice_payments
for insert to authenticated
with check (
  created_by = auth.uid()
  and public.can_manage_invoice_branch(business_id, branch_id)
  and exists (
    select 1 from public.branches br
    where br.id = branch_id
      and br.business_id = business_id
      and br.is_active
  )
);

drop policy if exists invoice_payments_update on public.invoice_payments;
create policy invoice_payments_update on public.invoice_payments
for update to authenticated
using (public.can_manage_invoice_branch(business_id, branch_id))
with check (public.can_manage_invoice_branch(business_id, branch_id));

drop policy if exists invoice_payments_delete on public.invoice_payments;
create policy invoice_payments_delete on public.invoice_payments
for delete to authenticated
using (public.can_manage_invoice_branch(business_id, branch_id));

commit;
