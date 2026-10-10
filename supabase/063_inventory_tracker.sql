-- Independent Inventory Tracker. It does not alter legacy inventory tables.
begin;

create table if not exists public.inventory_tracker_materials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  item_name text not null,
  quantity numeric(14,2) not null default 0 check (quantity >= 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (business_id, branch_id, item_name)
);
create table if not exists public.inventory_tracker_vehicles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  vehicle_name text not null, plate_number text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.inventory_tracker_usage (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  vehicle_id uuid not null references public.inventory_tracker_vehicles(id) on delete cascade,
  recorded_by uuid references auth.users(id) on delete set null, recorded_at timestamptz not null default now()
);
create table if not exists public.inventory_tracker_usage_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  usage_id uuid not null references public.inventory_tracker_usage(id) on delete cascade,
  material_id uuid not null references public.inventory_tracker_materials(id) on delete restrict,
  material_name text not null, quantity numeric(14,2) not null check (quantity > 0), created_at timestamptz not null default now()
);
create index if not exists inventory_tracker_materials_branch_idx on public.inventory_tracker_materials (business_id,branch_id,item_name);
create index if not exists inventory_tracker_vehicles_branch_idx on public.inventory_tracker_vehicles (business_id,branch_id,created_at desc);
create index if not exists inventory_tracker_usage_vehicle_idx on public.inventory_tracker_usage (vehicle_id,recorded_at desc);
create index if not exists inventory_tracker_usage_lines_usage_idx on public.inventory_tracker_usage_lines (usage_id);
drop trigger if exists set_inventory_tracker_materials_updated_at on public.inventory_tracker_materials;
create trigger set_inventory_tracker_materials_updated_at before update on public.inventory_tracker_materials for each row execute procedure public.set_updated_at();
drop trigger if exists set_inventory_tracker_vehicles_updated_at on public.inventory_tracker_vehicles;
create trigger set_inventory_tracker_vehicles_updated_at before update on public.inventory_tracker_vehicles for each row execute procedure public.set_updated_at();
alter table public.inventory_tracker_materials enable row level security;
alter table public.inventory_tracker_vehicles enable row level security;
alter table public.inventory_tracker_usage enable row level security;
alter table public.inventory_tracker_usage_lines enable row level security;
create policy inventory_tracker_materials_read on public.inventory_tracker_materials for select to authenticated using (public.is_platform_admin() or public.is_business_member(business_id));
create policy inventory_tracker_materials_manage on public.inventory_tracker_materials for all to authenticated using (public.is_platform_admin() or public.is_business_manager(business_id)) with check ((public.is_platform_admin() or public.is_business_manager(business_id)) and exists (select 1 from public.branches b where b.id=branch_id and b.business_id=business_id and b.is_active));
create policy inventory_tracker_vehicles_read on public.inventory_tracker_vehicles for select to authenticated using (public.is_platform_admin() or public.is_business_member(business_id));
create policy inventory_tracker_vehicles_manage on public.inventory_tracker_vehicles for all to authenticated using (public.is_platform_admin() or public.is_business_manager(business_id)) with check ((public.is_platform_admin() or public.is_business_manager(business_id)) and exists (select 1 from public.branches b where b.id=branch_id and b.business_id=business_id and b.is_active));
create policy inventory_tracker_usage_read on public.inventory_tracker_usage for select to authenticated using (public.is_platform_admin() or public.is_business_member(business_id));
create policy inventory_tracker_usage_manage on public.inventory_tracker_usage for all to authenticated using (public.is_platform_admin() or public.is_business_manager(business_id)) with check (public.is_platform_admin() or public.is_business_manager(business_id));
create policy inventory_tracker_usage_lines_read on public.inventory_tracker_usage_lines for select to authenticated using (public.is_platform_admin() or public.is_business_member(business_id));
create policy inventory_tracker_usage_lines_manage on public.inventory_tracker_usage_lines for all to authenticated using (public.is_platform_admin() or public.is_business_manager(business_id)) with check (public.is_platform_admin() or public.is_business_manager(business_id));
create or replace function public.adjust_inventory_tracker_stock(p_material_id uuid,p_delta numeric) returns numeric language plpgsql security definer set search_path=public as $$
declare m public.inventory_tracker_materials%rowtype; next_quantity numeric;
begin select * into m from public.inventory_tracker_materials where id=p_material_id for update; if not found or not(public.is_platform_admin() or public.is_business_manager(m.business_id)) then raise exception 'Material is unavailable'; end if; next_quantity:=m.quantity+coalesce(p_delta,0); if next_quantity<0 then raise exception 'Not enough stock available'; end if; update public.inventory_tracker_materials set quantity=next_quantity,updated_by=auth.uid() where id=m.id; return next_quantity; end; $$;
create or replace function public.set_inventory_tracker_material(p_business_id uuid,p_branch_id uuid,p_item_name text,p_quantity numeric) returns uuid language plpgsql security definer set search_path=public as $$
declare material_id uuid;
begin if trim(coalesce(p_item_name,''))='' or coalesce(p_quantity,0)<0 then raise exception 'Enter a material name and a valid quantity'; end if; if not(public.is_platform_admin() or public.is_business_manager(p_business_id)) then raise exception 'Inventory Tracker access is required'; end if; if not exists(select 1 from public.branches where id=p_branch_id and business_id=p_business_id and is_active) then raise exception 'Branch is unavailable'; end if; insert into public.inventory_tracker_materials(business_id,branch_id,item_name,quantity,created_by,updated_by) values(p_business_id,p_branch_id,trim(p_item_name),p_quantity,auth.uid(),auth.uid()) on conflict(business_id,branch_id,item_name) do update set quantity=excluded.quantity,updated_by=auth.uid() returning id into material_id; return material_id; end; $$;
create or replace function public.record_inventory_tracker_usage(p_vehicle_id uuid,p_lines jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare v public.inventory_tracker_vehicles%rowtype; r record; m public.inventory_tracker_materials%rowtype; usage_id uuid;
begin select * into v from public.inventory_tracker_vehicles where id=p_vehicle_id for update; if not found or not(public.is_platform_admin() or public.is_business_manager(v.business_id)) then raise exception 'Vehicle is unavailable'; end if; if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Add at least one material line'; end if; for r in select (x.value->>'material_id')::uuid as material_id,sum((x.value->>'quantity')::numeric) as quantity from jsonb_array_elements(p_lines)x(value) group by (x.value->>'material_id')::uuid order by (x.value->>'material_id')::uuid loop if r.quantity<=0 then raise exception 'Quantity must be greater than zero'; end if; select * into m from public.inventory_tracker_materials where id=r.material_id and business_id=v.business_id and branch_id=v.branch_id for update; if not found then raise exception 'A selected material is unavailable'; end if; if m.quantity<r.quantity then raise exception 'Not enough % in stock. Available: %',m.item_name,m.quantity; end if; end loop; insert into public.inventory_tracker_usage(business_id,branch_id,vehicle_id,recorded_by) values(v.business_id,v.branch_id,v.id,auth.uid()) returning id into usage_id; for r in select (x.value->>'material_id')::uuid as material_id,sum((x.value->>'quantity')::numeric) as quantity from jsonb_array_elements(p_lines)x(value) group by (x.value->>'material_id')::uuid order by (x.value->>'material_id')::uuid loop select * into m from public.inventory_tracker_materials where id=r.material_id for update; update public.inventory_tracker_materials set quantity=quantity-r.quantity,updated_by=auth.uid() where id=m.id; insert into public.inventory_tracker_usage_lines(business_id,branch_id,usage_id,material_id,material_name,quantity) values(v.business_id,v.branch_id,usage_id,m.id,m.item_name,r.quantity); end loop; return usage_id; end; $$;
grant execute on function public.adjust_inventory_tracker_stock(uuid,numeric) to authenticated;
grant execute on function public.set_inventory_tracker_material(uuid,uuid,text,numeric) to authenticated;
grant execute on function public.record_inventory_tracker_usage(uuid,jsonb) to authenticated;
drop trigger if exists audit_inventory_tracker_materials on public.inventory_tracker_materials;
create trigger audit_inventory_tracker_materials after insert or update or delete on public.inventory_tracker_materials for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_inventory_tracker_vehicles on public.inventory_tracker_vehicles;
create trigger audit_inventory_tracker_vehicles after insert or update or delete on public.inventory_tracker_vehicles for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_inventory_tracker_usage on public.inventory_tracker_usage;
create trigger audit_inventory_tracker_usage after insert or update or delete on public.inventory_tracker_usage for each row execute procedure public.capture_business_audit();
drop trigger if exists audit_inventory_tracker_usage_lines on public.inventory_tracker_usage_lines;
create trigger audit_inventory_tracker_usage_lines after insert or update or delete on public.inventory_tracker_usage_lines for each row execute procedure public.capture_business_audit();
commit;
