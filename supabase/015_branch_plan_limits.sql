-- Each business starts with one branch. Extra branches require an approved upgrade.
begin;

alter table public.business_management
  add column if not exists branch_limit integer not null default 1 check (branch_limit >= 1);

create table if not exists public.branch_upgrade_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  current_branch_limit integer not null,
  requested_branch_total integer not null check (requested_branch_total >= 2),
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists branch_upgrade_one_pending_per_business
on public.branch_upgrade_requests (business_id) where status='pending';

create or replace function public.enforce_branch_plan_limit()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  allowed integer;
  used integer;
begin
  select coalesce(m.branch_limit,1) into allowed
  from public.businesses b
  left join public.business_management m on m.business_id=b.id
  where b.id=new.business_id;
  select count(*) into used from public.branches where business_id=new.business_id and is_active;
  if used >= coalesce(allowed,1) then
    raise exception 'Branch limit reached. Request a branch upgrade before creating another branch.';
  end if;
  insert into public.audit_logs (business_id, actor_id, action, entity_type, entity_id, details)
  values (new.business_id, auth.uid(), 'branch_created', 'branch', new.id::text, jsonb_build_object('name',new.name));
  return new;
end;
$$;

drop trigger if exists enforce_branch_plan_limit on public.branches;
create trigger enforce_branch_plan_limit
before insert on public.branches
for each row execute procedure public.enforce_branch_plan_limit();

alter table public.branch_upgrade_requests enable row level security;

drop policy if exists branch_upgrade_requests_read on public.branch_upgrade_requests;
create policy branch_upgrade_requests_read on public.branch_upgrade_requests for select to authenticated
using (public.is_platform_admin() or public.is_business_member(business_id));

drop policy if exists branch_upgrade_requests_create on public.branch_upgrade_requests;
create policy branch_upgrade_requests_create on public.branch_upgrade_requests for insert to authenticated
with check (requested_by=auth.uid() and (public.is_platform_admin() or public.is_business_manager(business_id)));

drop policy if exists branch_upgrade_requests_admin_manage on public.branch_upgrade_requests;
create policy branch_upgrade_requests_admin_manage on public.branch_upgrade_requests for update to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

commit;
