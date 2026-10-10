-- Keep an individual dated log for every unit material quantity adjustment.
begin;

create table if not exists public.inventory_tracker_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  vehicle_id uuid not null references public.inventory_tracker_vehicles(id) on delete cascade,
  material_id uuid not null references public.inventory_tracker_materials(id) on delete restrict,
  material_name text not null,
  delta numeric(14,2) not null check (delta <> 0),
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now()
);
create index if not exists inventory_tracker_adjustments_vehicle_idx
  on public.inventory_tracker_adjustments (vehicle_id, recorded_at desc);
alter table public.inventory_tracker_adjustments enable row level security;
create policy inventory_tracker_adjustments_read on public.inventory_tracker_adjustments for select to authenticated
  using (public.is_platform_admin() or public.is_business_member(business_id));
create policy inventory_tracker_adjustments_manage on public.inventory_tracker_adjustments for all to authenticated
  using (public.is_platform_admin() or public.is_business_manager(business_id))
  with check (public.is_platform_admin() or public.is_business_manager(business_id));

create or replace function public.log_inventory_tracker_adjustment(
  p_vehicle_id uuid, p_material_id uuid, p_delta numeric
) returns uuid language plpgsql security definer set search_path=public as $$
declare v public.inventory_tracker_vehicles%rowtype; m public.inventory_tracker_materials%rowtype; adjustment_id uuid;
begin
  if coalesce(p_delta,0)=0 then raise exception 'Adjustment must not be zero'; end if;
  select * into v from public.inventory_tracker_vehicles where id=p_vehicle_id for update;
  if not found or not(public.is_platform_admin() or public.is_business_manager(v.business_id)) then raise exception 'Vehicle is unavailable'; end if;
  select * into m from public.inventory_tracker_materials where id=p_material_id and business_id=v.business_id and branch_id=v.branch_id;
  if not found then raise exception 'Material is unavailable'; end if;
  insert into public.inventory_tracker_adjustments(business_id,branch_id,vehicle_id,material_id,material_name,delta,recorded_by)
  values(v.business_id,v.branch_id,v.id,m.id,m.item_name,p_delta,auth.uid()) returning id into adjustment_id;
  return adjustment_id;
end; $$;
grant execute on function public.log_inventory_tracker_adjustment(uuid,uuid,numeric) to authenticated;
drop trigger if exists audit_inventory_tracker_adjustments on public.inventory_tracker_adjustments;
create trigger audit_inventory_tracker_adjustments after insert or update or delete on public.inventory_tracker_adjustments for each row execute procedure public.capture_business_audit();
commit;
