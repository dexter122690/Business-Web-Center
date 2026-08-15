-- Let active, owner-approved staff manage invoices only in their assigned branch.
-- This replaces the older "business manager" invoice rule, which did not recognize
-- branch-specific Admin permissions from Team Access.

begin;

create or replace function public.can_view_invoice_branch(target_business_id uuid, target_branch_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
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
        and coalesce(membership.permissions ->> 'invoices', 'none') in ('view', 'edit')
    );
$$;

create or replace function public.can_manage_invoice_branch(target_business_id uuid, target_branch_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
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
        and coalesce(membership.permissions ->> 'invoices', 'none') = 'edit'
    );
$$;

-- Restore branch access for older active staff whose accepted invitation predates
-- the branch-access table. Inactive invitations remain inactive on purpose.
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

drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices
for select to authenticated
using (public.can_view_invoice_branch(business_id, branch_id));

drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices
for insert to authenticated
with check (
  created_by = auth.uid()
  and public.can_manage_invoice_branch(business_id, branch_id)
);

drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices
for update to authenticated
using (public.can_manage_invoice_branch(business_id, branch_id))
with check (public.can_manage_invoice_branch(business_id, branch_id));

drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete on public.invoices
for delete to authenticated
using (public.can_manage_invoice_branch(business_id, branch_id));

drop policy if exists invoice_services_read on public.invoice_services;
create policy invoice_services_read on public.invoice_services
for select to authenticated
using (exists (
  select 1 from public.invoices invoice
  where invoice.id = invoice_id
    and public.can_view_invoice_branch(invoice.business_id, invoice.branch_id)
));

drop policy if exists invoice_services_manage on public.invoice_services;
create policy invoice_services_manage on public.invoice_services
for all to authenticated
using (exists (
  select 1 from public.invoices invoice
  where invoice.id = invoice_id
    and public.can_manage_invoice_branch(invoice.business_id, invoice.branch_id)
))
with check (exists (
  select 1 from public.invoices invoice
  where invoice.id = invoice_id
    and public.can_manage_invoice_branch(invoice.business_id, invoice.branch_id)
));

drop policy if exists invoice_parts_read on public.invoice_parts;
create policy invoice_parts_read on public.invoice_parts
for select to authenticated
using (exists (
  select 1 from public.invoices invoice
  where invoice.id = invoice_id
    and public.can_view_invoice_branch(invoice.business_id, invoice.branch_id)
));

drop policy if exists invoice_parts_manage on public.invoice_parts;
create policy invoice_parts_manage on public.invoice_parts
for all to authenticated
using (exists (
  select 1 from public.invoices invoice
  where invoice.id = invoice_id
    and public.can_manage_invoice_branch(invoice.business_id, invoice.branch_id)
))
with check (exists (
  select 1 from public.invoices invoice
  where invoice.id = invoice_id
    and public.can_manage_invoice_branch(invoice.business_id, invoice.branch_id)
));

commit;
