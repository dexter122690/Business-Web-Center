-- Owner-approved staff access with a branch assignment and clear permissions.
-- Run this once in Supabase SQL Editor before publishing the matching site files.

begin;

alter table public.business_memberships
  add column if not exists permissions jsonb not null default '{"dashboard":"view","invoices":"view","expenses":"view","payroll":"none","inventory":"view","schedule":"view"}'::jsonb;

alter table public.business_team_invites
  add column if not exists branch_id uuid references public.branches(id) on delete set null,
  add column if not exists permissions jsonb not null default '{"dashboard":"view","invoices":"view","expenses":"view","payroll":"none","inventory":"view","schedule":"view"}'::jsonb,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz;

alter table public.business_team_invites
  drop constraint if exists business_team_invites_status_check;
alter table public.business_team_invites
  add constraint business_team_invites_status_check
  check (status in ('pending', 'approved', 'accepted', 'inactive', 'cancelled'));

-- Older versions accepted an invitation as soon as its email matched a profile.
-- Approval must now remain an owner action, so remove that automatic bypass.
drop trigger if exists accept_existing_team_invite on public.business_team_invites;

-- Existing accepted invitations are kept working after this upgrade.
update public.business_team_invites
set status = 'approved', approved_at = coalesce(approved_at, accepted_at, now())
where status = 'accepted';

create table if not exists public.business_member_branch_access (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id, branch_id)
);

create index if not exists member_branch_access_user_idx
  on public.business_member_branch_access(user_id, business_id);

alter table public.business_member_branch_access enable row level security;

create or replace function public.is_business_owner(target_business_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.business_memberships
    where business_id = target_business_id and user_id = auth.uid()
      and status = 'active' and role = 'owner'
  );
$$;

drop policy if exists member_branch_access_read on public.business_member_branch_access;
create policy member_branch_access_read on public.business_member_branch_access
for select to authenticated using (
  user_id = auth.uid() or public.is_platform_admin() or public.is_business_owner(business_id)
);

drop policy if exists member_branch_access_owner_manage on public.business_member_branch_access;
create policy member_branch_access_owner_manage on public.business_member_branch_access
for all to authenticated using (public.is_platform_admin() or public.is_business_owner(business_id))
with check (public.is_platform_admin() or public.is_business_owner(business_id));

-- Only an owner may invite, approve, change a role, or suspend staff.
drop policy if exists team_invites_manager_manage on public.business_team_invites;
drop policy if exists team_invites_owner_manage on public.business_team_invites;
create policy team_invites_owner_manage on public.business_team_invites
for all to authenticated
using (public.is_platform_admin() or public.is_business_owner(business_id))
with check (public.is_platform_admin() or public.is_business_owner(business_id));

-- Invited people must create a separate account first. Approval is then required.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  requested_business_name text;
begin
  insert into public.profiles (id, email, full_name, mobile_number)
  values (new.id, new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'mobile_number', '')), ''))
  on conflict (id) do nothing;

  requested_business_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'business_name', '')), '');
  if requested_business_name is not null then
    insert into public.businesses (name, status, created_by)
    values (requested_business_name, 'pending', new.id);
  end if;
  return new;
end;
$$;

create or replace function public.sync_my_team_invites()
returns integer language plpgsql security definer set search_path = public as $$
declare linked_count integer := 0;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;

  insert into public.business_memberships (business_id, user_id, role, status, permissions)
  select invite.business_id, auth.uid(), invite.role, 'active', invite.permissions
  from public.business_team_invites invite
  join public.profiles profile on profile.id = auth.uid()
  join public.businesses business on business.id = invite.business_id and business.status = 'active'
  where lower(invite.email) = lower(profile.email) and invite.status = 'approved'
  on conflict (business_id, user_id) do update
    set role = excluded.role, status = 'active', permissions = excluded.permissions;
  get diagnostics linked_count = row_count;

  insert into public.business_member_branch_access (business_id, user_id, branch_id)
  select invite.business_id, auth.uid(), invite.branch_id
  from public.business_team_invites invite
  join public.profiles profile on profile.id = auth.uid()
  where lower(invite.email) = lower(profile.email)
    and invite.status = 'approved' and invite.branch_id is not null
  on conflict do nothing;

  update public.business_team_invites invite set status = 'accepted', accepted_at = coalesce(accepted_at, now())
  from public.profiles profile
  where profile.id = auth.uid() and lower(invite.email) = lower(profile.email)
    and invite.status = 'approved';
  return linked_count;
end;
$$;
grant execute on function public.sync_my_team_invites() to authenticated;

-- Existing active team members keep the MAIN branch unless an owner changes them.
insert into public.business_member_branch_access (business_id, user_id, branch_id)
select membership.business_id, membership.user_id, branch.id
from public.business_memberships membership
join lateral (
  select id from public.branches where business_id = membership.business_id and is_active
  order by created_at limit 1
) branch on true
where membership.role in ('admin', 'staff') and membership.status = 'active'
on conflict do nothing;

commit;
