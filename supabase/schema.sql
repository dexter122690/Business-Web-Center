-- Business Web Center: secure multi-business foundation
-- Run this file in Supabase SQL Editor once, then keep it versioned in GitHub.

begin;

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  platform_role text not null default 'customer'
    check (platform_role in ('customer', 'platform_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended')),
  plan text not null default 'starter',
  created_by uuid not null references auth.users(id) on delete restrict,
  brand_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_memberships (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner'
    check (role in ('owner', 'admin', 'staff')),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  address text,
  contact_number text,
  email text,
  is_active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  business_id uuid references public.businesses(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists business_memberships_user_id_idx
  on public.business_memberships(user_id);
create index if not exists branches_business_id_idx
  on public.branches(business_id);
create index if not exists audit_logs_business_created_idx
  on public.audit_logs(business_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists set_businesses_updated_at on public.businesses;
create trigger set_businesses_updated_at
before update on public.businesses
for each row execute procedure public.set_updated_at();

drop trigger if exists set_branches_updated_at on public.branches;
create trigger set_branches_updated_at
before update on public.branches
for each row execute procedure public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.add_business_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.business_memberships (business_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (business_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_business_created on public.businesses;
create trigger on_business_created
after insert on public.businesses
for each row execute procedure public.add_business_owner();

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select platform_role = 'platform_admin'
    from public.profiles
    where id = auth.uid()
  ), false);
$$;

create or replace function public.is_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_memberships
    where business_id = target_business_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function public.is_business_manager(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_memberships
    where business_id = target_business_id
      and user_id = auth.uid()
      and status = 'active'
      and role in ('owner', 'admin')
  );
$$;

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.business_memberships enable row level security;
alter table public.branches enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_platform_admin());

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
for update to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists businesses_read on public.businesses;
create policy businesses_read on public.businesses
for select to authenticated
using (public.is_platform_admin() or public.is_business_member(id));

drop policy if exists businesses_create_pending on public.businesses;
create policy businesses_create_pending on public.businesses
for insert to authenticated
with check (created_by = auth.uid() and status = 'pending');

drop policy if exists businesses_admin_manage on public.businesses;
create policy businesses_admin_manage on public.businesses
for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists memberships_read on public.business_memberships;
create policy memberships_read on public.business_memberships
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_business_manager(business_id)
  or public.is_platform_admin()
);

drop policy if exists memberships_admin_manage on public.business_memberships;
create policy memberships_admin_manage on public.business_memberships
for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists branches_read on public.branches;
create policy branches_read on public.branches
for select to authenticated
using (public.is_platform_admin() or public.is_business_member(business_id));

drop policy if exists branches_manager_manage on public.branches;
create policy branches_manager_manage on public.branches
for all to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id))
with check (public.is_platform_admin() or public.is_business_manager(business_id));

drop policy if exists audit_logs_read on public.audit_logs;
create policy audit_logs_read on public.audit_logs
for select to authenticated
using (
  public.is_platform_admin()
  or (business_id is not null and public.is_business_member(business_id))
);

drop policy if exists audit_logs_admin_insert on public.audit_logs;
create policy audit_logs_admin_insert on public.audit_logs
for insert to authenticated
with check (public.is_platform_admin());

commit;
