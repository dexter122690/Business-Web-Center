-- Allow approved branch staff to use Expenses and Cash Controls only
-- when their Team Access permission for Expenses is set to Can edit.
-- This migration changes access rules only. It does not delete or change
-- receipts, cash movements, invoices, or any other existing data.

begin;

create or replace function public.can_view_expense_branch(target_business_id uuid, target_branch_id uuid)
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
        and coalesce(membership.permissions ->> 'expenses', 'none') in ('view', 'edit')
    );
$$;

create or replace function public.can_manage_expense_branch(target_business_id uuid, target_branch_id uuid)
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
        and coalesce(membership.permissions ->> 'expenses', 'none') = 'edit'
    );
$$;

-- Give previously approved staff a usable branch-access record.
insert into public.business_member_branch_access (business_id, user_id, branch_id)
select invite.business_id, profile.id, invite.branch_id
from public.business_team_invites invite
join public.profiles profile on lower(profile.email) = lower(invite.email)
join public.business_memberships membership
  on membership.business_id = invite.business_id
 and membership.user_id = profile.id
 and membership.status = 'active'
where invite.status in ('approved', 'accepted')
  and invite.branch_id is not null
on conflict do nothing;

drop policy if exists expenses_read on public.expenses;
create policy expenses_read on public.expenses
for select to authenticated
using (public.can_view_expense_branch(business_id, branch_id));

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
for insert to authenticated
with check (
  created_by = auth.uid()
  and public.can_manage_expense_branch(business_id, branch_id)
);

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses
for update to authenticated
using (public.can_manage_expense_branch(business_id, branch_id))
with check (public.can_manage_expense_branch(business_id, branch_id));

drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete on public.expenses
for delete to authenticated
using (public.can_manage_expense_branch(business_id, branch_id));

drop policy if exists cash_transactions_read on public.cash_transactions;
create policy cash_transactions_read on public.cash_transactions
for select to authenticated
using (public.can_view_expense_branch(business_id, branch_id));

drop policy if exists cash_transactions_insert on public.cash_transactions;
create policy cash_transactions_insert on public.cash_transactions
for insert to authenticated
with check (
  created_by = auth.uid()
  and public.can_manage_expense_branch(business_id, branch_id)
);

drop policy if exists cash_transactions_update on public.cash_transactions;
create policy cash_transactions_update on public.cash_transactions
for update to authenticated
using (public.can_manage_expense_branch(business_id, branch_id))
with check (public.can_manage_expense_branch(business_id, branch_id));

drop policy if exists cash_transactions_delete on public.cash_transactions;
create policy cash_transactions_delete on public.cash_transactions
for delete to authenticated
using (public.can_manage_expense_branch(business_id, branch_id));

commit;
