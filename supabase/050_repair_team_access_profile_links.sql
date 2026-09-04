-- Repair Team Access when an existing Auth account has no matching or has a
-- stale public profile row. This uses the actual signed-in Auth email, then
-- rebuilds membership and branch access from approved Team Access records.
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
set search_path = public, auth
as $$
declare
  target_user_id uuid;
begin
  select auth_user.id
    into target_user_id
  from auth.users auth_user
  left join public.profiles profile on profile.id = auth_user.id
  where lower(auth_user.email) = lower(target_email)
     or lower(coalesce(profile.email, '')) = lower(target_email)
  order by case when lower(auth_user.email) = lower(target_email) then 0 else 1 end
  limit 1;

  if target_user_id is null then
    return false;
  end if;

  insert into public.profiles (id, email, full_name, mobile_number)
  values (target_user_id, lower(target_email), '', null)
  on conflict (id) do update
    set email = excluded.email;

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

create or replace function public.refresh_my_team_access()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_email text;
  invite record;
  refreshed_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  select auth_user.email
    into current_email
  from auth.users auth_user
  where auth_user.id = auth.uid();

  if current_email is null then
    return 0;
  end if;

  insert into public.profiles (id, email, full_name, mobile_number)
  values (auth.uid(), lower(current_email), '', null)
  on conflict (id) do update
    set email = excluded.email;

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

-- Repair every current approved or accepted Team Access assignment now.
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

revoke all on function public.apply_team_invite_access(uuid, text, text, jsonb, uuid) from public;
revoke all on function public.refresh_my_team_access() from public;
grant execute on function public.refresh_my_team_access() to authenticated;

commit;
