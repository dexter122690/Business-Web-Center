-- Repair existing staff access after a branch assignment was changed.
-- Safe to run more than once. It does not remove invoices, expenses, payroll, or other business data.

begin;

-- Every approved or accepted invitation belonging to a registered user gets
-- an active membership with the permissions chosen by the business owner.
insert into public.business_memberships (business_id, user_id, role, status, permissions)
select
  invite.business_id,
  profile.id,
  coalesce(nullif(lower(invite.role), ''), 'staff'),
  'active',
  coalesce(invite.permissions, '{"dashboard":"view","invoices":"view","expenses":"view","payroll":"none","inventory":"view","schedule":"view"}'::jsonb)
from public.business_team_invites invite
join public.profiles profile on lower(profile.email) = lower(invite.email)
join public.businesses business on business.id = invite.business_id
where invite.status in ('approved', 'accepted')
  and business.status = 'active'
on conflict (business_id, user_id) do update
set role = excluded.role,
    status = 'active',
    permissions = excluded.permissions;

-- Rebuild only the branch access that each active invitation currently names.
-- This gives an approved Sto. Tomas user explicit permission for Sto. Tomas.
insert into public.business_member_branch_access (business_id, user_id, branch_id)
select
  invite.business_id,
  profile.id,
  invite.branch_id
from public.business_team_invites invite
join public.profiles profile on lower(profile.email) = lower(invite.email)
join public.branches branch on branch.id = invite.branch_id
  and branch.business_id = invite.business_id
  and branch.is_active = true
where invite.status in ('approved', 'accepted')
  and invite.branch_id is not null
on conflict do nothing;

commit;

-- Verification: Joy and Jomari (and any other approved staff) should appear
-- with the selected branch and active membership.
select
  invite.email,
  invite.status as invitation_status,
  branch.name as assigned_branch,
  membership.status as membership_status,
  membership.permissions,
  access.branch_id is not null as branch_access_active
from public.business_team_invites invite
left join public.profiles profile on lower(profile.email) = lower(invite.email)
left join public.branches branch on branch.id = invite.branch_id
left join public.business_memberships membership
  on membership.business_id = invite.business_id and membership.user_id = profile.id
left join public.business_member_branch_access access
  on access.business_id = invite.business_id and access.user_id = profile.id and access.branch_id = invite.branch_id
where invite.status in ('approved', 'accepted')
order by branch.name nulls last, invite.email;
