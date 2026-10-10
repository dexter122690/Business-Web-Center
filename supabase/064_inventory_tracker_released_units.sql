-- Inventory Tracker: retain released units and their usage history separately from active work.
begin;

alter table public.inventory_tracker_vehicles
  add column if not exists released_at timestamptz,
  add column if not exists released_by uuid references auth.users(id) on delete set null;

create index if not exists inventory_tracker_vehicles_released_idx
  on public.inventory_tracker_vehicles (business_id, branch_id, released_at desc);

commit;
