-- Let every Team Access user with Inventory = Can edit record and correct
-- manual stock in their assigned branch. Expense-linked stock stays managed
-- through Expenses.

begin;

drop policy if exists inventory_movements_insert on public.inventory_stock_movements;
drop policy if exists inventory_movements_update on public.inventory_stock_movements;
drop policy if exists inventory_movements_delete on public.inventory_stock_movements;

create or replace function public.can_manage_inventory_branch(
  target_business_id uuid,
  target_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or public.is_business_owner(target_business_id)
    or exists (
      select 1
      from public.business_memberships membership
      join public.business_member_branch_access branch_access
        on branch_access.business_id = membership.business_id
       and branch_access.user_id = membership.user_id
      join public.branches branch on branch.id = branch_access.branch_id
      where membership.business_id = target_business_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and branch_access.branch_id = target_branch_id
        and branch.is_active
        and coalesce(membership.permissions ->> 'inventory', 'none') = 'edit'
    );
$$;

create policy inventory_movements_insert on public.inventory_stock_movements
for insert to authenticated
with check (
  created_by = auth.uid()
  and public.can_manage_inventory_branch(business_id, branch_id)
  and (
    movement_type = 'out'
    or (movement_type = 'in' and expense_id is null and invoice_id is null)
  )
);

create policy inventory_movements_update on public.inventory_stock_movements
for update to authenticated
using (
  public.can_manage_inventory_branch(business_id, branch_id)
  and (movement_type = 'out' or (movement_type = 'in' and expense_id is null and invoice_id is null))
)
with check (
  public.can_manage_inventory_branch(business_id, branch_id)
  and (movement_type = 'out' or (movement_type = 'in' and expense_id is null and invoice_id is null))
);

create policy inventory_movements_delete on public.inventory_stock_movements
for delete to authenticated
using (
  public.can_manage_inventory_branch(business_id, branch_id)
  and (movement_type = 'out' or (movement_type = 'in' and expense_id is null and invoice_id is null))
);

commit;
