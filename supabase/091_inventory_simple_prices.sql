-- One saved price list for new usage. No stock, price or historical usage is
-- changed by installation. Custom base coat is a separate per-vehicle cost.
begin;
alter table public.inventory_tracker_adjustments
  add column if not exists stock_cost_amount numeric(24,6),
  add column if not exists price_revision uuid;

create table if not exists public.inventory_tracker_basecoat (
  vehicle_id uuid primary key references public.inventory_tracker_vehicles(id) on delete cascade,
  business_id uuid not null references public.businesses(id),
  branch_id uuid not null references public.branches(id),
  quantity numeric(14,2) not null check(quantity>0 and quantity<=999999999),
  measure_unit text not null check(measure_unit in ('L','mL')),
  liters numeric(18,5) not null check(liters>0),
  amount numeric(20,2) not null check(amount>=0 and amount<=999999999),
  revision uuid not null default gen_random_uuid(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists public.inventory_tracker_simple_events (
  id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
  business_id uuid not null references public.businesses(id),
  branch_id uuid not null references public.branches(id),
  material_id uuid references public.inventory_tracker_materials(id),
  vehicle_id uuid references public.inventory_tracker_vehicles(id) on delete set null,
  action text not null, payload jsonb not null, before_record jsonb, after_record jsonb,
  result jsonb not null, recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index if not exists inventory_simple_vehicle_idx on public.inventory_tracker_simple_events(vehicle_id,recorded_at);
alter table public.inventory_tracker_basecoat enable row level security;
alter table public.inventory_tracker_simple_events enable row level security;
drop policy if exists inventory_basecoat_read on public.inventory_tracker_basecoat;
create policy inventory_basecoat_read on public.inventory_tracker_basecoat for select to authenticated
  using(public.can_view_tracker_costs(business_id,branch_id));
drop policy if exists inventory_simple_events_read on public.inventory_tracker_simple_events;
create policy inventory_simple_events_read on public.inventory_tracker_simple_events for select to authenticated
  using(public.can_view_tracker_costs(business_id,branch_id));
revoke all on public.inventory_tracker_basecoat,public.inventory_tracker_simple_events from public,anon,authenticated;
grant select on public.inventory_tracker_basecoat,public.inventory_tracker_simple_events to authenticated;

create or replace function public.inventory_tracker_simple_snapshot(p_business_id uuid,p_branch_id uuid,p_vehicle_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  result:=public.inventory_tracker_cost_snapshot(p_business_id,p_branch_id,p_vehicle_id);
  return result||jsonb_build_object('simple_pricing_version',1,
    'basecoat',(select to_jsonb(b) from public.inventory_tracker_basecoat b where b.vehicle_id=p_vehicle_id and b.business_id=p_business_id and b.branch_id=p_branch_id));
end; $$;

create or replace function public.inventory_tracker_simple_action(p_business_id uuid,p_branch_id uuid,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  m public.inventory_tracker_materials%rowtype; v public.inventory_tracker_vehicles%rowtype;
  ref public.inventory_tracker_reference_prices%rowtype; original public.inventory_tracker_adjustments%rowtype;
  prior public.inventory_tracker_simple_events%rowtype; coat public.inventory_tracker_basecoat%rowtype;
  act text:=p_payload->>'action'; mid uuid; vid uuid; aid uuid; result jsonb;
  q numeric; amount numeric; book_amount numeric; available numeric; returned_cost numeric; returned_book numeric;
  note_text text:=trim(coalesce(p_payload->>'note','')); before_row jsonb; after_row jsonb;
begin
  if auth.uid() is null or not public.can_manage_inventory_branch(p_business_id,p_branch_id)
    or not public.can_view_tracker_costs(p_business_id,p_branch_id) then raise exception 'Inventory edit access is required for this branch.'; end if;
  if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'A valid request and payload are required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into prior from public.inventory_tracker_simple_events where request_id=p_request_id;
  if found then
    if prior.business_id<>p_business_id or prior.branch_id<>p_branch_id or prior.recorded_by is distinct from auth.uid() or prior.payload<>p_payload then
      raise exception 'This request identifier was already used for a different operation.';
    end if;
    return prior.result||jsonb_build_object('duplicate',true);
  end if;
  if act is null or act not in ('use','return','stock','basecoat','basecoat_remove') then raise exception 'Unsupported inventory action.'; end if;
  if length(note_text) not between 3 and 1000 then raise exception 'Enter a reason (3–1000 characters).'; end if;
  vid:=nullif(p_payload->>'vehicle_id','')::uuid;
  if act<>'stock' then
    select * into v from public.inventory_tracker_vehicles where id=vid and business_id=p_business_id and branch_id=p_branch_id for update;
    if not found then raise exception 'Unit is unavailable in this branch.'; end if;
    if v.released_at is not null then raise exception 'Released units are read-only.'; end if;
  elsif vid is not null then raise exception 'A stock count cannot target a vehicle.'; end if;

  if act in ('basecoat','basecoat_remove') then
    select * into coat from public.inventory_tracker_basecoat where vehicle_id=vid;
    if coat.vehicle_id is not null and (coat.business_id<>p_business_id or coat.branch_id<>p_branch_id) then raise exception 'Base coat belongs to another branch.'; end if;
    if nullif(p_payload->>'expected_revision','')::uuid is distinct from coat.revision then raise exception 'Base coat changed in another session. Refresh before saving.'; end if;
    before_row:=case when coat.vehicle_id is not null then to_jsonb(coat) end;
    if act='basecoat_remove' then
      if coat.vehicle_id is null then raise exception 'No saved base coat to remove.'; end if;
      delete from public.inventory_tracker_basecoat where vehicle_id=vid;
    else
      q:=(p_payload->>'quantity')::numeric; amount:=(p_payload->>'amount')::numeric;
      if q is null or q::text in ('NaN','Infinity','-Infinity') or q<=0 or q>999999999 or q<>round(q,2) then raise exception 'Enter a positive base coat quantity with at most two decimal places.'; end if;
      if amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<0 or amount>999999999 or amount<>round(amount,2) then raise exception 'Enter the total cost of the base coat used (up to two decimal places).'; end if;
      if coalesce(p_payload->>'unit','') not in ('L','mL') then raise exception 'Choose L or mL.'; end if;
      insert into public.inventory_tracker_basecoat(vehicle_id,business_id,branch_id,quantity,measure_unit,liters,amount,updated_by)
        values(vid,p_business_id,p_branch_id,q,p_payload->>'unit',case when p_payload->>'unit'='mL' then q/1000 else q end,amount,auth.uid())
        on conflict(vehicle_id) do update set quantity=excluded.quantity,measure_unit=excluded.measure_unit,liters=excluded.liters,amount=excluded.amount,
          revision=gen_random_uuid(),updated_by=auth.uid(),updated_at=clock_timestamp() returning to_jsonb(inventory_tracker_basecoat.*) into after_row;
    end if;
  else
    mid:=(p_payload->>'material_id')::uuid;
    select * into m from public.inventory_tracker_materials where id=mid and business_id=p_business_id and branch_id=p_branch_id for update;
    if not found then raise exception 'Material is unavailable in this branch.'; end if;
    if nullif(p_payload->>'expected_updated_at','')::timestamptz is distinct from m.updated_at then raise exception 'Stock changed in another session. Refresh and try again.'; end if;
    before_row:=to_jsonb(m); q:=(p_payload->>'quantity')::numeric;
    if q is null or q::text in ('NaN','Infinity','-Infinity') or q<0 or q>999999999 or q<>round(q,2) or (act<>'stock' and q=0) then raise exception 'Enter a valid quantity with at most two decimal places.'; end if;
    if act='use' then
      -- The price is read under the same material lock used by price_save.
      -- Never accept a price supplied by the browser or infer an opening cost.
      select * into ref from public.inventory_tracker_reference_prices where material_id=mid and business_id=p_business_id and branch_id=p_branch_id;
      if not found then raise exception 'Set the price for % in Material prices first.',m.item_name; end if;
      if nullif(p_payload->>'expected_reference_revision','')::uuid is distinct from ref.revision then raise exception 'Material price changed. Refresh and review the saved price.'; end if;
      if m.quantity<q then raise exception 'Not enough stock available. Update General inventory first.'; end if;
      amount:=round(q*ref.price,6);
      book_amount:=case when m.cost_initialized then case when q=m.quantity then m.cost_value else round(q*m.cost_value/m.quantity,6) end else null end;
      insert into public.inventory_tracker_adjustments(business_id,branch_id,vehicle_id,material_id,material_name,delta,recorded_by,cost_version,unit_cost,cost_amount,measure_unit,cost_note,stock_cost_amount,price_revision)
        values(p_business_id,p_branch_id,vid,mid,m.item_name,q,auth.uid(),1,ref.price,amount,ref.price_unit,note_text,book_amount,ref.revision) returning id into aid;
      update public.inventory_tracker_materials set quantity=quantity-q,cost_value=case when cost_initialized then cost_value-book_amount else null end,updated_by=auth.uid() where id=mid;
    elsif act='return' then
      select * into original from public.inventory_tracker_adjustments where id=(p_payload->>'return_of')::uuid and vehicle_id=vid and material_id=mid
        and business_id=p_business_id and branch_id=p_branch_id and cost_version=1 and delta>0 for update;
      if not found then raise exception 'Select an original costed usage entry from this unit.'; end if;
      select original.delta+coalesce(sum(delta),0),-coalesce(sum(cost_amount),0),-coalesce(sum(coalesce(stock_cost_amount,case when price_revision is null then cost_amount end)),0)
        into available,returned_cost,returned_book from public.inventory_tracker_adjustments where return_of=original.id;
      if q>available then raise exception 'Return quantity exceeds the remaining usage.'; end if;
      amount:=case when q=available then original.cost_amount-returned_cost else round(q*original.cost_amount/original.delta,6) end;
      book_amount:=coalesce(original.stock_cost_amount,case when original.price_revision is null then original.cost_amount end);
      book_amount:=case when book_amount is null then null when q=available then book_amount-returned_book else round(q*book_amount/original.delta,6) end;
      if m.cost_initialized and book_amount is null then raise exception 'Stock valuation changed after this usage. Ask the owner to review it.'; end if;
      insert into public.inventory_tracker_adjustments(business_id,branch_id,vehicle_id,material_id,material_name,delta,recorded_by,cost_version,unit_cost,cost_amount,measure_unit,return_of,cost_note,stock_cost_amount,price_revision)
        values(p_business_id,p_branch_id,vid,mid,m.item_name,-q,auth.uid(),1,original.unit_cost,-amount,original.measure_unit,original.id,note_text,-book_amount,original.price_revision) returning id into aid;
      update public.inventory_tracker_materials set quantity=quantity+q,cost_value=case when cost_initialized then cost_value+book_amount else null end,updated_by=auth.uid() where id=mid;
    else
      if q=m.quantity then raise exception 'The stock count has not changed.'; end if;
      -- Retain the old book value proportionally when possible, but never require
      -- a second price entry or invent a valuation for previously unpriced stock.
      update public.inventory_tracker_materials set quantity=q,
        cost_value=case when cost_initialized and (m.quantity>0 or q=0) then case when q=0 then 0 else round(m.cost_value*q/m.quantity,6) end else null end,
        cost_initialized=cost_initialized and (m.quantity>0 or q=0),updated_by=auth.uid() where id=mid;
    end if;
    select to_jsonb(x) into after_row from public.inventory_tracker_materials x where id=mid;
  end if;
  result:=jsonb_build_object('ok',true,'adjustment_id',aid);
  insert into public.inventory_tracker_simple_events(request_id,business_id,branch_id,material_id,vehicle_id,action,payload,before_record,after_record,result,recorded_by)
    values(p_request_id,p_business_id,p_branch_id,mid,vid,act,p_payload,before_row,after_row,result,auth.uid());
  return result;
end; $$;
revoke all on function public.inventory_tracker_simple_snapshot(uuid,uuid,uuid),public.inventory_tracker_simple_action(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.inventory_tracker_simple_snapshot(uuid,uuid,uuid),public.inventory_tracker_simple_action(uuid,uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
