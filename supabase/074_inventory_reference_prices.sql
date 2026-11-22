-- Reference prices are a price list, never stock valuation or historical job cost.
-- Depends on 073. This migration does not edit materials, quantities, or expenses.
begin;

create table if not exists public.inventory_tracker_reference_prices (
  material_id uuid primary key references public.inventory_tracker_materials(id),
  business_id uuid not null references public.businesses(id),
  branch_id uuid not null references public.branches(id),
  price numeric(18,4) not null check (price>=0 and price<=999999999 and price::text not in ('NaN','Infinity','-Infinity')),
  price_unit text not null check (length(trim(price_unit)) between 1 and 50),
  note text not null check (length(trim(note)) between 3 and 1000),
  revision uuid not null default gen_random_uuid(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists public.inventory_tracker_reference_price_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  business_id uuid not null references public.businesses(id),
  branch_id uuid not null references public.branches(id),
  material_id uuid not null references public.inventory_tracker_materials(id),
  previous_price jsonb,
  saved_price jsonb not null,
  payload jsonb not null,
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now()
);
create index if not exists inventory_reference_price_events_branch_idx
  on public.inventory_tracker_reference_price_events(business_id,branch_id,recorded_at desc);

alter table public.inventory_tracker_reference_prices enable row level security;
alter table public.inventory_tracker_reference_price_events enable row level security;
drop policy if exists inventory_reference_prices_read on public.inventory_tracker_reference_prices;
create policy inventory_reference_prices_read on public.inventory_tracker_reference_prices for select to authenticated
  using(public.can_view_tracker_costs(business_id,branch_id));
drop policy if exists inventory_reference_price_events_read on public.inventory_tracker_reference_price_events;
create policy inventory_reference_price_events_read on public.inventory_tracker_reference_price_events for select to authenticated
  using(public.can_view_tracker_costs(business_id,branch_id));
revoke all on public.inventory_tracker_reference_prices,public.inventory_tracker_reference_price_events from public,anon,authenticated;
grant select on public.inventory_tracker_reference_prices,public.inventory_tracker_reference_price_events to authenticated;

create or replace function public.inventory_tracker_reference_price_snapshot(p_business_id uuid,p_branch_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.can_view_tracker_costs(p_business_id,p_branch_id) then
    raise exception 'Inventory access is required for this branch.';
  end if;
  return jsonb_build_object('version',1,'business_id',p_business_id,'branch_id',p_branch_id,
    'prices',coalesce((select jsonb_agg(to_jsonb(p) order by material_id) from public.inventory_tracker_reference_prices p
      where p.business_id=p_business_id and p.branch_id=p_branch_id),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(to_jsonb(e) order by recorded_at desc,id) from
      (select id,material_id,previous_price,saved_price,recorded_at from public.inventory_tracker_reference_price_events
       where business_id=p_business_id and branch_id=p_branch_id order by recorded_at desc,id limit 100) e),'[]'::jsonb));
end; $$;

create or replace function public.inventory_tracker_reference_price_save(p_business_id uuid,p_branch_id uuid,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  m public.inventory_tracker_materials%rowtype;
  prior public.inventory_tracker_reference_price_events%rowtype;
  old_price public.inventory_tracker_reference_prices%rowtype;
  saved public.inventory_tracker_reference_prices%rowtype;
  price_value numeric; unit_text text; note_text text; eid uuid;
begin
  if auth.uid() is null or not public.can_manage_inventory_branch(p_business_id,p_branch_id)
    or not public.can_view_tracker_costs(p_business_id,p_branch_id) then
    raise exception 'Inventory edit access is required for this branch.';
  end if;
  if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'A valid request identifier and price payload are required.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into prior from public.inventory_tracker_reference_price_events where request_id=p_request_id;
  if found then
    if prior.business_id<>p_business_id or prior.branch_id<>p_branch_id
      or prior.recorded_by is distinct from auth.uid() or prior.payload<>p_payload then
      raise exception 'This request identifier was already used for a different operation.';
    end if;
    return jsonb_build_object('ok',true,'duplicate',true,'event_id',prior.id);
  end if;
  -- Lock the catalogue identity, without updating its stock or measurement unit.
  select * into m from public.inventory_tracker_materials where id=(p_payload->>'material_id')::uuid
    and business_id=p_business_id and branch_id=p_branch_id for update;
  if not found then raise exception 'Material is unavailable in this branch.'; end if;
  select * into old_price from public.inventory_tracker_reference_prices where material_id=m.id;
  if old_price.material_id is not null and (old_price.business_id<>p_business_id or old_price.branch_id<>p_branch_id) then
    raise exception 'Reference price scope does not match this material.';
  end if;
  if nullif(p_payload->>'expected_revision','')::uuid is distinct from old_price.revision then
    raise exception 'The reference price changed in another session. Refresh and review it before saving.';
  end if;
  price_value:=(p_payload->>'price')::numeric;
  unit_text:=trim(coalesce(p_payload->>'unit',''));
  note_text:=trim(coalesce(p_payload->>'note',''));
  if price_value is null or price_value::text in ('NaN','Infinity','-Infinity') or price_value<0
    or price_value>999999999 or price_value<>round(price_value,4) then
    raise exception 'Enter a non-negative reference price with at most four decimal places.';
  end if;
  if length(unit_text) not between 1 and 50 then raise exception 'Specify the price unit or package size (up to 50 characters).'; end if;
  if length(note_text) not between 3 and 1000 then raise exception 'Enter a reason or source (3–1000 characters).'; end if;
  insert into public.inventory_tracker_reference_prices(material_id,business_id,branch_id,price,price_unit,note,updated_by)
    values(m.id,p_business_id,p_branch_id,price_value,unit_text,note_text,auth.uid())
    on conflict(material_id) do update set price=excluded.price,price_unit=excluded.price_unit,note=excluded.note,
      revision=gen_random_uuid(),updated_by=excluded.updated_by,updated_at=clock_timestamp()
    returning * into saved;
  insert into public.inventory_tracker_reference_price_events(request_id,business_id,branch_id,material_id,previous_price,saved_price,payload,recorded_by)
    values(p_request_id,p_business_id,p_branch_id,m.id,case when old_price.material_id is not null then to_jsonb(old_price) end,to_jsonb(saved),p_payload,auth.uid())
    returning id into eid;
  return jsonb_build_object('ok',true,'event_id',eid);
end; $$;

revoke all on function public.inventory_tracker_reference_price_snapshot(uuid,uuid),public.inventory_tracker_reference_price_save(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.inventory_tracker_reference_price_snapshot(uuid,uuid),public.inventory_tracker_reference_price_save(uuid,uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
