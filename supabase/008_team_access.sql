-- Team access for a single business workspace.
-- Owners and admins can invite other people by email. Each person keeps a separate login.

begin;

create table if not exists public.business_team_invites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null check (email = lower(email)),
  full_name text not null default '',
  role text not null default 'staff' check (role in ('admin', 'staff')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (business_id, email)
);

create index if not exists business_team_invites_business_idx
  on public.business_team_invites (business_id, created_at desc);

alter table public.business_team_invites enable row level security;

drop policy if exists team_invites_read on public.business_team_invites;
create policy team_invites_read on public.business_team_invites
for select to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id));

drop policy if exists team_invites_manager_manage on public.business_team_invites;
create policy team_invites_manager_manage on public.business_team_invites
for all to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id))
with check (
  public.is_platform_admin()
  or (public.is_business_manager(business_id) and role in ('admin', 'staff'))
);

-- Let business managers read the names and email addresses of people in their own team only.
drop policy if exists profiles_business_manager_read on public.profiles;
create policy profiles_business_manager_read on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or public.is_platform_admin()
  or exists (
    select 1 from public.business_memberships mine
    join public.business_memberships teammate on teammate.business_id = mine.business_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and mine.role in ('owner', 'admin')
      and teammate.user_id = profiles.id
  )
);

-- Managers can deactivate or change a non-owner team member between Admin and Staff.
drop policy if exists memberships_manager_manage_team on public.business_memberships;
create policy memberships_manager_manage_team on public.business_memberships
for update to authenticated
using (
  public.is_platform_admin()
  or (public.is_business_manager(business_id) and role in ('admin', 'staff'))
)
with check (
  public.is_platform_admin()
  or (public.is_business_manager(business_id) and role in ('admin', 'staff'))
);

-- If a person has already signed up, accept the invitation immediately.
create or replace function public.accept_existing_team_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_user uuid;
begin
  if new.status <> 'pending' then return new; end if;
  select id into invited_user from public.profiles where lower(email) = new.email limit 1;
  if invited_user is not null then
    insert into public.business_memberships (business_id, user_id, role, status)
    values (new.business_id, invited_user, new.role, 'active')
    on conflict (business_id, user_id) do update set role = excluded.role, status = 'active';
    new.status := 'accepted';
    new.accepted_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists accept_existing_team_invite on public.business_team_invites;
create trigger accept_existing_team_invite
before insert or update of email, role, status on public.business_team_invites
for each row execute procedure public.accept_existing_team_invite();

-- A new user who signs up with an invited email is added to that business automatically.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_business_name text;
begin
  insert into public.profiles (id, email, full_name, mobile_number)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'mobile_number', '')), '')
  ) on conflict (id) do nothing;

  insert into public.business_memberships (business_id, user_id, role, status)
  select business_id, new.id, role, 'active'
  from public.business_team_invites
  where email = lower(new.email) and status = 'pending'
  on conflict (business_id, user_id) do update set role = excluded.role, status = 'active';

  update public.business_team_invites
  set status = 'accepted', accepted_at = now()
  where email = lower(new.email) and status = 'pending';

  requested_business_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'business_name', '')), '');
  if requested_business_name is not null then
    insert into public.businesses (name, status, created_by)
    values (requested_business_name, 'pending', new.id);
  end if;
  return new;
end;
$$;

commit;
