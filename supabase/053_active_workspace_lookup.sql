-- Provide a stable, least-privilege active-workspace lookup for the signed-in
-- user.  This avoids relying on a browser-side embedded relationship query.
-- It exposes only the caller's own active memberships in active businesses.

begin;

create or replace function public.my_active_business_workspaces()
returns table (
  business_id uuid,
  business_name text,
  business_status text,
  member_role text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    membership.business_id,
    business.name,
    business.status,
    membership.role
  from public.business_memberships membership
  join public.businesses business on business.id = membership.business_id
  where membership.user_id = auth.uid()
    and membership.status = 'active'
    and business.status = 'active'
  order by business.created_at asc;
$$;

revoke all on function public.my_active_business_workspaces() from public;
grant execute on function public.my_active_business_workspaces() to authenticated;

commit;
