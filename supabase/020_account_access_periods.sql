-- Time-limited customer access. Existing accounts are unchanged until an
-- administrator approves or renews access from the approval dashboard.

begin;

alter table public.business_management
  add column if not exists access_days integer not null default 30
    check (access_days between 1 and 3650),
  add column if not exists access_started_at timestamptz,
  add column if not exists access_ends_at timestamptz;

create index if not exists business_management_access_ends_at_idx
  on public.business_management(access_ends_at)
  where access_ends_at is not null;

commit;
