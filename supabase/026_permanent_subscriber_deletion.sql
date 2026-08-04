-- Permanently removes one customer workspace and, when safe, the owner's sign-in account.
-- Run this in the Supabase SQL Editor after migration 025.

begin;

create or replace function public.delete_subscriber_business(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_owner uuid;
  target_name text;
  remaining_memberships integer;
  remaining_owned_businesses integer;
  owner_is_platform_admin boolean;
  account_deleted boolean := false;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the platform administrator can permanently delete a subscriber.';
  end if;

  select created_by, name into target_owner, target_name
  from public.businesses
  where id = p_business_id;
  if target_owner is null then raise exception 'Subscriber workspace was not found.'; end if;
  if target_owner = auth.uid() then raise exception 'The platform administrator account cannot be deleted from this screen.'; end if;

  -- Every tenant table references this workspace with cascading deletion.
  delete from public.businesses where id = p_business_id;

  select count(*) into remaining_memberships from public.business_memberships where user_id = target_owner;
  select count(*) into remaining_owned_businesses from public.businesses where created_by = target_owner;
  select platform_role = 'platform_admin' into owner_is_platform_admin from public.profiles where id = target_owner;

  -- Do not remove a sign-in that still belongs to another workspace.
  if coalesce(remaining_memberships, 0) = 0
     and coalesce(remaining_owned_businesses, 0) = 0
     and not coalesce(owner_is_platform_admin, false) then
    delete from auth.users where id = target_owner;
    account_deleted := true;
  end if;

  return jsonb_build_object('business_name', target_name, 'account_deleted', account_deleted);
end;
$$;

revoke all on function public.delete_subscriber_business(uuid) from public;
grant execute on function public.delete_subscriber_business(uuid) to authenticated;

commit;
