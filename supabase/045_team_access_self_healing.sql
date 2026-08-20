-- Keep Team Access assignments synchronized with the permissions used by
-- invoices and expenses. This repairs existing approved/accepted staff and
-- automatically protects future branch assignments from becoming stale.
begin;

create or replace function public.apply_team_invite_access(
  target_business_id uuid,
  target_email text,
  target_role text,
  target_permissions jsonb,
  target_branch_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
begin
  select profile.id
    into target_user_id
  from public.profiles profile
  where lower(profile.email) = lower(target_email)
  limit 1;

  if target_user_id is null then
    return false;
  end if;

  insert into public.business_memberships
    (business_id, user_id, role, status, permissions)
  values
    (target_business_id, target_user_id, target_role, 'active',
     coalesce(target_permissions,
       '{"dashboard":"view","invoices":"view","expenses":"view","payroll":"none","inventory":"view","schedule":"view"}'::jsonb))
  on conflict (business_id, user_id) do update
    set role = excluded.role,
        status = 'active',
        permissions = excluded.permissions;

  if target_branch_id is not null then
    insert into public.business_member_branch_access
      (business_id, user_id, branch_id)
    values
      (target_business_id, target_user_id, target_branch_id)
    on conflict do nothing;
  end if;

  return true;
end;
$$;

create or replace function public.sync_team_invite_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('approved', 'accepted') then
    perform public.apply_team_invite_access(
      new.business_id,
      new.email,
      new.role,
      new.permissions,
      new.branch_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists sync_team_invite_access_after_write
  on public.business_team_invites;
create trigger sync_team_invite_access_after_write
after insert or update of email, status, role, permissions, branch_id
on public.business_team_invites
for each row execute function public.sync_team_invite_access();

-- Repair all current approved and accepted assignments, including Jomari's
-- Sto. Tomas assignment, without changing invoices, expenses, or other data.
do $$
declare
  invite record;
begin
  for invite in
    select business_id, email, role, permissions, branch_id
    from public.business_team_invites
    where status in ('approved', 'accepted')
    order by created_at
  loop
    perform public.apply_team_invite_access(
      invite.business_id,
      invite.email,
      invite.role,
      invite.permissions,
      invite.branch_id
    );
  end loop;
end;
$$;

create or replace function public.refresh_my_team_access()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_email text;
  invite record;
  refreshed_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  select profile.email
    into current_email
  from public.profiles profile
  where profile.id = auth.uid();

  if current_email is null then
    return 0;
  end if;

  for invite in
    select business_id, email, role, permissions, branch_id
    from public.business_team_invites
    where lower(email) = lower(current_email)
      and status in ('approved', 'accepted')
    order by created_at
  loop
    if public.apply_team_invite_access(
      invite.business_id,
      invite.email,
      invite.role,
      invite.permissions,
      invite.branch_id
    ) then
      refreshed_count := refreshed_count + 1;
    end if;
  end loop;

  return refreshed_count;
end;
$$;

-- Only the signed-in self-repair entry point is callable from the browser.
-- The two internal helpers run only through the database trigger/function.
revoke all on function public.apply_team_invite_access(uuid, text, text, jsonb, uuid) from public;
revoke all on function public.sync_team_invite_access() from public;
revoke all on function public.refresh_my_team_access() from public;
grant execute on function public.refresh_my_team_access() to authenticated;

create or replace function public.can_view_invoice_branch(
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
        and coalesce(membership.permissions ->> 'invoices', 'none') in ('view', 'edit')
    )
    or exists (
      select 1
      from public.business_team_invites invite
      join public.profiles profile on profile.id = auth.uid()
      join public.branches branch on branch.id = invite.branch_id
      where invite.business_id = target_business_id
        and invite.branch_id = target_branch_id
        and lower(invite.email) = lower(profile.email)
        and invite.status in ('approved', 'accepted')
        and branch.is_active
        and coalesce(invite.permissions ->> 'invoices', 'none') in ('view', 'edit')
    );
$$;

create or replace function public.can_manage_invoice_branch(
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
        and coalesce(membership.permissions ->> 'invoices', 'none') = 'edit'
    )
    or exists (
      select 1
      from public.business_team_invites invite
      join public.profiles profile on profile.id = auth.uid()
      join public.branches branch on branch.id = invite.branch_id
      where invite.business_id = target_business_id
        and invite.branch_id = target_branch_id
        and lower(invite.email) = lower(profile.email)
        and invite.status in ('approved', 'accepted')
        and branch.is_active
        and coalesce(invite.permissions ->> 'invoices', 'none') = 'edit'
    );
$$;

create or replace function public.can_view_expense_branch(
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
        and coalesce(membership.permissions ->> 'expenses', 'none') in ('view', 'edit')
    )
    or exists (
      select 1
      from public.business_team_invites invite
      join public.profiles profile on profile.id = auth.uid()
      join public.branches branch on branch.id = invite.branch_id
      where invite.business_id = target_business_id
        and invite.branch_id = target_branch_id
        and lower(invite.email) = lower(profile.email)
        and invite.status in ('approved', 'accepted')
        and branch.is_active
        and coalesce(invite.permissions ->> 'expenses', 'none') in ('view', 'edit')
    );
$$;

create or replace function public.can_manage_expense_branch(
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
        and coalesce(membership.permissions ->> 'expenses', 'none') = 'edit'
    )
    or exists (
      select 1
      from public.business_team_invites invite
      join public.profiles profile on profile.id = auth.uid()
      join public.branches branch on branch.id = invite.branch_id
      where invite.business_id = target_business_id
        and invite.branch_id = target_branch_id
        and lower(invite.email) = lower(profile.email)
        and invite.status in ('approved', 'accepted')
        and branch.is_active
        and coalesce(invite.permissions ->> 'expenses', 'none') = 'edit'
    );
$$;

commit;
