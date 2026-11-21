-- Receipt-based moving-average costing. No existing quantity, usage or expense is changed.
-- Apply before deploying the matching inventory-costing.js client. Old stock writers
-- deliberately fail closed after this migration; reload BWC to use the atomic writer.
begin;

alter table public.inventory_tracker_materials
  add column if not exists measure_unit text,
  add column if not exists cost_value numeric(24,6),
  add column if not exists cost_initialized boolean not null default false;
alter table public.inventory_tracker_adjustments
  add column if not exists cost_version integer,
  add column if not exists unit_cost numeric(24,8),
  add column if not exists cost_amount numeric(24,6),
  add column if not exists measure_unit text,
  add column if not exists return_of uuid references public.inventory_tracker_adjustments(id),
  add column if not exists cost_note text;

do $$ begin
  alter table public.inventory_tracker_materials add constraint inventory_material_cost_state check (
    (not cost_initialized and cost_value is null) or
    (cost_initialized and cost_value is not null and cost_value>=0 and cost_value::text not in ('NaN','Infinity','-Infinity')
      and measure_unit is not null and length(trim(measure_unit))>0 and (quantity>0 or cost_value=0)));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.inventory_tracker_adjustments add constraint inventory_adjustment_cost_state check (
    cost_version is null or (cost_version=1 and unit_cost is not null and cost_amount is not null
      and unit_cost>=0 and unit_cost::text not in ('NaN','Infinity','-Infinity')
      and cost_amount::text not in ('NaN','Infinity','-Infinity') and delta*cost_amount>=0
      and measure_unit is not null and length(trim(measure_unit))>0));
exception when duplicate_object then null; end $$;

create table if not exists public.inventory_tracker_cost_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  business_id uuid not null references public.businesses(id),
  branch_id uuid not null references public.branches(id),
  material_id uuid not null references public.inventory_tracker_materials(id),
  vehicle_id uuid references public.inventory_tracker_vehicles(id) on delete set null,
  action text not null,
  quantity numeric(14,2) not null,
  amount numeric(24,6) not null,
  supplier text, receipt text, purchase_date date, note text not null,
  payload jsonb not null,
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now()
);
create table if not exists public.inventory_tracker_cost_baselines (
  vehicle_id uuid not null references public.inventory_tracker_vehicles(id) on delete cascade,
  material_id uuid not null references public.inventory_tracker_materials(id),
  business_id uuid not null references public.businesses(id),
  branch_id uuid not null references public.branches(id),
  quantity numeric(14,2) not null check(quantity>=0),
  unit_cost numeric(24,8) not null check(unit_cost>=0),
  amount numeric(24,6) not null check(amount>=0),
  measure_unit text not null,
  note text not null,
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  primary key(vehicle_id,material_id)
);
create index if not exists inventory_cost_events_material_idx on public.inventory_tracker_cost_events(material_id,recorded_at);
create index if not exists inventory_adjustment_return_idx on public.inventory_tracker_adjustments(return_of);

create or replace function public.can_view_tracker_costs(p_business uuid,p_branch uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.branches b where b.id=p_branch and b.business_id=p_business and b.is_active)
    and (public.is_platform_admin() or public.is_business_owner(p_business) or exists(
      select 1 from public.business_memberships m
      join public.business_member_branch_access a on a.business_id=m.business_id and a.user_id=m.user_id
      where m.business_id=p_business and m.user_id=auth.uid() and m.status='active'
        and a.branch_id=p_branch and coalesce(m.permissions->>'inventory','none') in ('view','edit')));
$$;
alter table public.inventory_tracker_cost_events enable row level security;
alter table public.inventory_tracker_cost_baselines enable row level security;
drop policy if exists inventory_cost_events_read on public.inventory_tracker_cost_events;
create policy inventory_cost_events_read on public.inventory_tracker_cost_events for select to authenticated using(public.can_view_tracker_costs(business_id,branch_id));
drop policy if exists inventory_cost_baselines_read on public.inventory_tracker_cost_baselines;
create policy inventory_cost_baselines_read on public.inventory_tracker_cost_baselines for select to authenticated using(public.can_view_tracker_costs(business_id,branch_id));
grant select on public.inventory_tracker_cost_events,public.inventory_tracker_cost_baselines to authenticated;
revoke insert,update,delete on public.inventory_tracker_cost_events,public.inventory_tracker_cost_baselines from authenticated,anon;

-- Only the new checked transaction may mutate material stock or usage. Zero-stock
-- catalogue seeding remains supported; this never assigns a price to old records.
drop policy if exists inventory_tracker_materials_manage on public.inventory_tracker_materials;
drop policy if exists inventory_tracker_usage_manage on public.inventory_tracker_usage;
drop policy if exists inventory_tracker_usage_lines_manage on public.inventory_tracker_usage_lines;
drop policy if exists inventory_tracker_adjustments_manage on public.inventory_tracker_adjustments;
drop policy if exists inventory_tracker_zero_material_insert on public.inventory_tracker_materials;
create policy inventory_tracker_zero_material_insert on public.inventory_tracker_materials for insert to authenticated with check(
  public.can_manage_inventory_branch(business_id,branch_id) and quantity=0 and cost_value is null and not cost_initialized and measure_unit is null
  and exists(select 1 from public.branches b where b.id=branch_id and b.business_id=inventory_tracker_materials.business_id and b.is_active));
revoke update,delete on public.inventory_tracker_materials from authenticated,anon;
revoke insert,update,delete on public.inventory_tracker_usage,public.inventory_tracker_usage_lines,public.inventory_tracker_adjustments from authenticated,anon;
create or replace function public.adjust_inventory_tracker_stock(p_material_id uuid,p_delta numeric)
returns numeric language plpgsql security definer set search_path=public as $$ begin raise exception 'Reload BWC and use Record purchase or Correct stock count. Stock changes now require a cost record.'; end $$;
create or replace function public.set_inventory_tracker_material(p_business_id uuid,p_branch_id uuid,p_item_name text,p_quantity numeric)
returns uuid language plpgsql security definer set search_path=public as $$ begin raise exception 'Reload BWC to use receipt-based inventory costing.'; end $$;
create or replace function public.record_inventory_tracker_usage(p_vehicle_id uuid,p_lines jsonb)
returns uuid language plpgsql security definer set search_path=public as $$ begin raise exception 'Reload BWC to record quantity and material cost together.'; end $$;
create or replace function public.log_inventory_tracker_adjustment(p_vehicle_id uuid,p_material_id uuid,p_delta numeric)
returns uuid language plpgsql security definer set search_path=public as $$ begin raise exception 'Reload BWC to record quantity and material cost together.'; end $$;

create or replace function public.inventory_tracker_cost_action(p_business_id uuid,p_branch_id uuid,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  m public.inventory_tracker_materials%rowtype; v public.inventory_tracker_vehicles%rowtype;
  prior public.inventory_tracker_cost_events%rowtype; original public.inventory_tracker_adjustments%rowtype;
  act text:=p_payload->>'action'; mid uuid; vid uuid; aid uuid;
  q numeric; price numeric; amount numeric:=0; avg_cost numeric; available numeric; returned_cost numeric;
  unit_name text:=trim(coalesce(p_payload->>'unit','')); note_text text:=trim(coalesce(p_payload->>'note',''));
  legacy_count integer; purchase_day date;
begin
  if auth.uid() is null or not public.can_manage_inventory_branch(p_business_id,p_branch_id)
    or not public.can_view_tracker_costs(p_business_id,p_branch_id) then raise exception 'Inventory edit access is required for this branch.'; end if;
  if p_request_id is null or jsonb_typeof(p_payload)<>'object' then raise exception 'A valid request identifier and payload are required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into prior from public.inventory_tracker_cost_events where request_id=p_request_id;
  if found then
    if prior.business_id<>p_business_id or prior.branch_id<>p_branch_id or prior.recorded_by is distinct from auth.uid() or prior.payload<>p_payload then raise exception 'This request identifier was already used for a different operation.'; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'event_id',prior.id);
  end if;
  if act is null or act not in ('create','opening','purchase','count','use','return','baseline') then raise exception 'Unsupported inventory action.'; end if;
  if length(note_text)<3 or length(note_text)>1000 then raise exception 'Enter a reason or receipt reference (3–1000 characters).'; end if;
  vid:=nullif(p_payload->>'vehicle_id','')::uuid;
  if act in ('use','return','baseline') then
    select * into v from public.inventory_tracker_vehicles where id=vid and business_id=p_business_id and branch_id=p_branch_id for update;
    if not found then raise exception 'Unit is unavailable in this branch.'; end if;
    if v.released_at is not null and act<>'baseline' then raise exception 'Released units are read-only; no stock can be issued or returned here.'; end if;
  elsif vid is not null then raise exception 'This stock action cannot target a vehicle.';
  end if;
  if act='create' then
    if length(trim(coalesce(p_payload->>'name','')))<1 or length(p_payload->>'name')>150 then raise exception 'Enter a material name (up to 150 characters).'; end if;
    insert into public.inventory_tracker_materials(business_id,branch_id,item_name,quantity,created_by,updated_by)
      values(p_business_id,p_branch_id,trim(p_payload->>'name'),0,auth.uid(),auth.uid()) returning * into m;
    mid:=m.id; q:=0;
  else
    mid:=(p_payload->>'material_id')::uuid;
    select * into m from public.inventory_tracker_materials where id=mid and business_id=p_business_id and branch_id=p_branch_id for update;
    if not found then raise exception 'Material is unavailable in this branch.'; end if;
    if act<>'baseline' and (nullif(p_payload->>'expected_updated_at','')::timestamptz is distinct from m.updated_at) then
      raise exception 'Stock or its price changed in another session. Refresh and review the current figures before saving.';
    end if;
    q:=(p_payload->>'quantity')::numeric;
    if q is null or q::text in ('NaN','Infinity','-Infinity') or q<0 or q>999999999 or q<>round(q,2) then raise exception 'Enter a non-negative quantity with at most two decimal places.'; end if;
    if act in ('purchase','use','return') and q<=0 then raise exception 'Quantity must be greater than zero.'; end if;
    if act in ('opening','purchase','baseline') then
      price:=(p_payload->>'unit_cost')::numeric;
      if price is null or price::text in ('NaN','Infinity','-Infinity') or price<0 or price>999999999 or price<>round(price,4) then raise exception 'Enter a verified, non-negative unit purchase cost (up to four decimal places).'; end if;
      if length(unit_name)<1 or length(unit_name)>30 then raise exception 'Specify the measurement unit (piece, liter, gallon, etc.).'; end if;
      if m.measure_unit is not null and m.measure_unit<>unit_name then raise exception 'The measurement unit must match this material. Create a separate material for a different size or unit.'; end if;
    end if;
  end if;
  if act='opening' then
    if m.cost_initialized then raise exception 'Opening stock has already been valued. Use purchases or a stock-count correction instead.'; end if;
    if q<>m.quantity then raise exception 'Opening valuation must match the existing stock quantity; it does not add stock.'; end if;
    amount:=round(q*price,6);
    update public.inventory_tracker_materials set cost_value=amount,cost_initialized=true,measure_unit=unit_name,updated_by=auth.uid() where id=mid;
  elsif act='purchase' then
    if not m.cost_initialized and m.quantity<>0 then raise exception 'Value the existing stock first so its cost is not treated as zero.'; end if;
    if length(trim(coalesce(p_payload->>'supplier','')))=0 or length(trim(coalesce(p_payload->>'receipt','')))=0 then raise exception 'Supplier and receipt/reference are required.'; end if;
    purchase_day:=(p_payload->>'purchase_date')::date;
    if purchase_day is null or purchase_day>(now() at time zone 'Asia/Manila')::date then raise exception 'Enter the actual purchase date, not a future date.'; end if;
    amount:=round(q*price,6);
    update public.inventory_tracker_materials set quantity=quantity+q,cost_value=coalesce(cost_value,0)+amount,cost_initialized=true,measure_unit=unit_name,updated_by=auth.uid() where id=mid;
  elsif act='count' then
    if not m.cost_initialized then raise exception 'Value existing stock before a stock-count correction.'; end if;
    if m.quantity=0 and q>0 then raise exception 'Use Record purchase to add stock with a known cost.'; end if;
    avg_cost:=case when m.quantity>0 then m.cost_value/m.quantity else 0 end;
    q:=q-m.quantity; amount:=round(q*avg_cost,6);
    if q=0 then raise exception 'The stock count has not changed.'; end if;
    update public.inventory_tracker_materials set quantity=quantity+q,cost_value=case when quantity+q=0 then 0 else cost_value+amount end,updated_by=auth.uid() where id=mid;
  elsif act='use' then
    if not m.cost_initialized then raise exception 'Record the opening stock cost or a purchase before issuing this material.'; end if;
    if m.quantity<q then raise exception 'Not enough stock available.'; end if;
    avg_cost:=m.cost_value/m.quantity; amount:=case when q=m.quantity then m.cost_value else round(q*avg_cost,6) end;
    insert into public.inventory_tracker_adjustments(business_id,branch_id,vehicle_id,material_id,material_name,delta,recorded_by,cost_version,unit_cost,cost_amount,measure_unit,cost_note)
      values(p_business_id,p_branch_id,vid,mid,m.item_name,q,auth.uid(),1,avg_cost,amount,m.measure_unit,note_text);
    update public.inventory_tracker_materials set quantity=quantity-q,cost_value=cost_value-amount,updated_by=auth.uid() where id=mid;
  elsif act='return' then
    select * into original from public.inventory_tracker_adjustments where id=(p_payload->>'return_of')::uuid and vehicle_id=vid and material_id=mid and business_id=p_business_id and branch_id=p_branch_id and cost_version=1 and delta>0 for update;
    if not found then raise exception 'Select an original costed usage entry from this unit.'; end if;
    select original.delta+coalesce(sum(delta),0),-coalesce(sum(cost_amount),0) into available,returned_cost from public.inventory_tracker_adjustments where return_of=original.id;
    if q>available then raise exception 'Return quantity exceeds the remaining quantity from that usage entry.'; end if;
    amount:=case when q=available then original.cost_amount-returned_cost else round(q*original.cost_amount/original.delta,6) end;
    insert into public.inventory_tracker_adjustments(business_id,branch_id,vehicle_id,material_id,material_name,delta,recorded_by,cost_version,unit_cost,cost_amount,measure_unit,return_of,cost_note)
      values(p_business_id,p_branch_id,vid,mid,m.item_name,-q,auth.uid(),1,original.unit_cost,-amount,original.measure_unit,original.id,note_text);
    update public.inventory_tracker_materials set quantity=quantity+q,cost_value=cost_value+amount,updated_by=auth.uid() where id=mid;
    q:=-q; amount:=-amount;
  elsif act='baseline' then
    -- The two historical sources may overlap. An explicit reviewed quantity replaces
    -- their uncertain total for costing only; neither source nor stock is rewritten.
    select (select count(*) from public.inventory_tracker_adjustments a where a.vehicle_id=vid and a.material_id=mid and a.cost_version is null)
      +(select count(*) from public.inventory_tracker_usage_lines l join public.inventory_tracker_usage u on u.id=l.usage_id where u.vehicle_id=vid and l.material_id=mid) into legacy_count;
    if legacy_count=0 then raise exception 'No pre-costing history exists for this material on this unit.'; end if;
    if not coalesce((p_payload->>'confirmed')::boolean,false) then raise exception 'Confirm that the historical quantity was checked for duplicate records.'; end if;
    amount:=round(q*price,6);
    insert into public.inventory_tracker_cost_baselines(vehicle_id,material_id,business_id,branch_id,quantity,unit_cost,amount,measure_unit,note,recorded_by)
      values(vid,mid,p_business_id,p_branch_id,q,price,amount,unit_name,note_text,auth.uid());
    -- Set the measurement label, never the current stock price or quantity.
    if m.measure_unit is null then update public.inventory_tracker_materials set measure_unit=unit_name,updated_by=auth.uid() where id=mid; end if;
  end if;
  insert into public.inventory_tracker_cost_events(request_id,business_id,branch_id,material_id,vehicle_id,action,quantity,amount,supplier,receipt,purchase_date,note,payload,recorded_by)
    values(p_request_id,p_business_id,p_branch_id,mid,vid,act,q,amount,left(p_payload->>'supplier',200),left(p_payload->>'receipt',200),purchase_day,note_text,p_payload,auth.uid()) returning id into aid;
  return jsonb_build_object('ok',true,'event_id',aid,'material_id',mid);
end;
$$;

-- One server-side snapshot: complete aggregates, no PostgREST 1,000-row truncation.
create or replace function public.inventory_tracker_cost_snapshot(p_business_id uuid,p_branch_id uuid,p_vehicle_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb; v jsonb;
begin
  if auth.uid() is null or not public.can_view_tracker_costs(p_business_id,p_branch_id) then raise exception 'Inventory access is required for this branch.'; end if;
  if p_vehicle_id is not null then
    select to_jsonb(x) into v from public.inventory_tracker_vehicles x where x.id=p_vehicle_id and x.business_id=p_business_id and x.branch_id=p_branch_id;
    if v is null then raise exception 'This unit is unavailable in the selected branch.'; end if;
  end if;
  with rows as (
    select m.id,m.item_name,m.quantity,m.measure_unit,m.cost_initialized,m.cost_value,m.updated_at,
      case when m.cost_initialized and m.quantity>0 then m.cost_value/m.quantity end as stock_unit_cost,
      coalesce(a.new_qty,0) as new_qty,coalesce(a.new_cost,0) as new_cost,
      coalesce(a.old_qty,0) as old_adjustment_qty,coalesce(a.old_count,0) as old_adjustment_count,
      coalesce(l.old_qty,0) as old_usage_qty,coalesce(l.old_count,0) as old_usage_count,
      to_jsonb(b) as baseline
    from public.inventory_tracker_materials m
    left join lateral(select sum(delta) filter(where cost_version=1) as new_qty,sum(cost_amount) filter(where cost_version=1) as new_cost,
      sum(delta) filter(where cost_version is null) as old_qty,count(*) filter(where cost_version is null) as old_count
      from public.inventory_tracker_adjustments where vehicle_id=p_vehicle_id and material_id=m.id and business_id=p_business_id and branch_id=p_branch_id) a on true
    left join lateral(select sum(l.quantity) as old_qty,count(*) as old_count from public.inventory_tracker_usage_lines l
      join public.inventory_tracker_usage u on u.id=l.usage_id where u.vehicle_id=p_vehicle_id and l.material_id=m.id
      and l.business_id=p_business_id and l.branch_id=p_branch_id and u.business_id=p_business_id and u.branch_id=p_branch_id) l on true
    left join public.inventory_tracker_cost_baselines b on b.vehicle_id=p_vehicle_id and b.material_id=m.id
    where m.business_id=p_business_id and m.branch_id=p_branch_id
  ) select jsonb_build_object('version',1,'business_id',p_business_id,'branch_id',p_branch_id,'vehicle',v,
    'can_edit',public.can_manage_inventory_branch(p_business_id,p_branch_id),
    'materials',coalesce(jsonb_agg(to_jsonb(rows) order by item_name),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(to_jsonb(a) order by recorded_at desc,id) from public.inventory_tracker_adjustments a
      where a.vehicle_id=p_vehicle_id and a.business_id=p_business_id and a.branch_id=p_branch_id and a.cost_version=1),'[]'::jsonb),
    'purchases',coalesce((select jsonb_agg(to_jsonb(e) order by recorded_at desc,id) from
      (select id,material_id,action,quantity,amount,supplier,receipt,purchase_date,note,recorded_at from public.inventory_tracker_cost_events
       where business_id=p_business_id and branch_id=p_branch_id and action in ('purchase','opening','count') order by recorded_at desc,id limit 100) e),'[]'::jsonb)
  ) into result from rows;
  return result;
end;
$$;
revoke all on function public.inventory_tracker_cost_action(uuid,uuid,uuid,jsonb),public.inventory_tracker_cost_snapshot(uuid,uuid,uuid),public.can_view_tracker_costs(uuid,uuid) from public,anon;
grant execute on function public.inventory_tracker_cost_action(uuid,uuid,uuid,jsonb),public.inventory_tracker_cost_snapshot(uuid,uuid,uuid),public.can_view_tracker_costs(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
