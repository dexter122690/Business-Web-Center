-- Remove a staff invitation and the staff member's access to one business.
-- This intentionally keeps the person's Supabase sign-in account, because it
-- may belong to another business. They can be invited to this business again.

begin;

create or replace function public.delete_business_team_member(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_row public.business_team_invites%rowtype;
  member_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  select * into invite_row
  from public.business_team_invites
  where id = p_invite_id;

  if not found then
    raise exception 'Team invitation was not found.';
  end if;

  if not public.is_platform_admin()
     and not public.is_business_owner(invite_row.business_id) then
    raise exception 'Only the business owner can delete a team member.';
  end if;

  select id into member_user_id
  from public.profiles
  where lower(email) = lower(invite_row.email)
  limit 1;

  if member_user_id is not null then
    delete from public.business_member_branch_access
    where business_id = invite_row.business_id
      and user_id = member_user_id;

    delete from public.business_memberships
    where business_id = invite_row.business_id
      and user_id = member_user_id
      and role in ('admin', 'staff');
  end if;

  delete from public.business_team_invites
  where id = p_invite_id;
end;
$$;

grant execute on function public.delete_business_team_member(uuid) to authenticated;

commit;
