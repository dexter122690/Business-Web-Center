-- Manual opening stock and stock corrections are restricted to the business owner.
-- Expense-imported stock-in continues to be created by the protected expense trigger.

begin;

create or replace function public.is_business_owner(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_memberships
    where business_id = target_business_id
      and user_id = auth.uid()
      and status = 'active'
      and role = 'owner'
  );
$$;

drop policy if exists inventory_movements_manage on public.inventory_stock_movements;
drop policy if exists inventory_movements_insert on public.inventory_stock_movements;
drop policy if exists inventory_movements_update on public.inventory_stock_movements;
drop policy if exists inventory_movements_delete on public.inventory_stock_movements;

-- Admins may record stock-out to a unit or general use. Only owners may add or
-- alter manual stock-in / opening stock. Expense-linked stock-in is maintained
-- through the security-definer expense trigger.
create policy inventory_movements_insert on public.inventory_stock_movements
for insert to authenticated
with check (
  public.is_platform_admin()
  or (
    public.is_business_manager(business_id)
    and exists (
      select 1 from public.branches br
      where br.id = branch_id
        and br.business_id = business_id
        and br.is_active
    )
    and (
      movement_type = 'out'
      or expense_id is not null
      or public.is_business_owner(business_id)
    )
  )
);

create policy inventory_movements_update on public.inventory_stock_movements
for update to authenticated
using (
  public.is_platform_admin()
  or (
    public.is_business_manager(business_id)
    and (movement_type = 'out' or public.is_business_owner(business_id))
  )
)
with check (
  public.is_platform_admin()
  or (
    public.is_business_manager(business_id)
    and exists (
      select 1 from public.branches br
      where br.id = branch_id
        and br.business_id = business_id
        and br.is_active
    )
    and (movement_type = 'out' or public.is_business_owner(business_id))
  )
);

create policy inventory_movements_delete on public.inventory_stock_movements
for delete to authenticated
using (
  public.is_platform_admin()
  or (
    public.is_business_manager(business_id)
    and (movement_type = 'out' or public.is_business_owner(business_id))
  )
);

grant execute on function public.is_business_owner(uuid) to authenticated;

commit;
