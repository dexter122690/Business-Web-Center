-- Repair and future-proof team invitations.
-- An invited person is linked to the inviting business the first time they sign in.

begin;

create or replace function public.sync_my_team_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to accept a team invitation.';
  end if;

  insert into public.business_memberships (business_id, user_id, role, status)
  select invite.business_id, auth.uid(), invite.role, 'active'
  from public.business_team_invites invite
  join public.profiles profile on profile.id = auth.uid()
  join public.businesses business on business.id = invite.business_id
  where lower(invite.email) = lower(profile.email)
    and invite.status in ('pending', 'accepted')
    and business.status = 'active'
  on conflict (business_id, user_id) do update
    set role = excluded.role,
        status = 'active';

  get diagnostics linked_count = row_count;

  update public.business_team_invites invite
  set status = 'accepted',
      accepted_at = coalesce(invite.accepted_at, now())
  from public.profiles profile
  where profile.id = auth.uid()
    and lower(invite.email) = lower(profile.email)
    and invite.status = 'pending';

  return linked_count;
end;
$$;

grant execute on function public.sync_my_team_invites() to authenticated;

-- Backfill every valid team invite now, including staff who created their
-- account before this repair was installed.
insert into public.business_memberships (business_id, user_id, role, status)
select invite.business_id, profile.id, invite.role, 'active'
from public.business_team_invites invite
join public.profiles profile on lower(profile.email) = lower(invite.email)
join public.businesses business on business.id = invite.business_id
where invite.status in ('pending', 'accepted')
  and business.status = 'active'
on conflict (business_id, user_id) do update
  set role = excluded.role,
      status = 'active';

update public.business_team_invites invite
set status = 'accepted',
    accepted_at = coalesce(invite.accepted_at, now())
where invite.status = 'pending'
  and exists (
    select 1
    from public.profiles profile
    where lower(profile.email) = lower(invite.email)
  );

commit;
