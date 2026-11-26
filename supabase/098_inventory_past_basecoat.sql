-- Add/replace ONE historical basecoat cost on a released unit. Installation
-- changes functions only; existing stock, usage, expenses and costs stay intact.
begin;

create or replace function public.inventory_tracker_archive_basecoat_save(
  p_business_id uuid,p_branch_id uuid,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v public.inventory_tracker_vehicles%rowtype;
  coat public.inventory_tracker_basecoat%rowtype;
  prior public.inventory_tracker_simple_events%rowtype;
  vid uuid; q numeric; amount numeric; before_row jsonb; after_row jsonb; result jsonb;
  note_text text:=trim(coalesce(p_payload->>'note',''));
begin
  if auth.uid() is null or not public.can_manage_inventory_branch(p_business_id,p_branch_id)
    or not public.can_view_tracker_costs(p_business_id,p_branch_id) then
    raise exception 'Inventory edit access is required for this branch.';
  end if;
  if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload->>'action' is distinct from 'past_basecoat' then
    raise exception 'A valid past basecoat request is required.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into prior from public.inventory_tracker_simple_events where request_id=p_request_id;
  if found then
    if prior.business_id<>p_business_id or prior.branch_id<>p_branch_id
      or prior.recorded_by is distinct from auth.uid() or prior.action<>'past_basecoat'
      or prior.payload<>p_payload then
      raise exception 'This request identifier was already used for a different operation.';
    end if;
    return prior.result||jsonb_build_object('duplicate',true);
  end if;
  if length(note_text) not between 3 and 1000 then raise exception 'Enter a note or reference (3–1000 characters).'; end if;
  vid:=nullif(p_payload->>'vehicle_id','')::uuid;
  select * into v from public.inventory_tracker_vehicles
    where id=vid and business_id=p_business_id and branch_id=p_branch_id for update;
  if not found then raise exception 'Unit is unavailable in this branch.'; end if;
  if v.released_at is null then raise exception 'Past basecoat is only available for released units.'; end if;
  select * into coat from public.inventory_tracker_basecoat where vehicle_id=vid;
  if coat.vehicle_id is not null and (coat.business_id<>p_business_id or coat.branch_id<>p_branch_id) then
    raise exception 'Basecoat belongs to another branch.';
  end if;
  if nullif(p_payload->>'expected_revision','')::uuid is distinct from coat.revision then
    raise exception 'Basecoat changed in another session. Close and reopen this form before saving.';
  end if;
  q:=(p_payload->>'quantity')::numeric; amount:=(p_payload->>'amount')::numeric;
  if q is null or q::text in ('NaN','Infinity','-Infinity') or q<=0 or q>999999999 or q<>round(q,2) then
    raise exception 'Enter a positive basecoat quantity with at most two decimal places.';
  end if;
  if amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<0 or amount>999999999 or amount<>round(amount,2) then
    raise exception 'Enter the total cost of the basecoat used (up to two decimal places).';
  end if;
  if coalesce(p_payload->>'unit','') not in ('L','mL') then raise exception 'Choose L or mL.'; end if;
  before_row:=case when coat.vehicle_id is not null then to_jsonb(coat) end;
  insert into public.inventory_tracker_basecoat(vehicle_id,business_id,branch_id,quantity,measure_unit,liters,amount,updated_by)
    values(vid,p_business_id,p_branch_id,q,p_payload->>'unit',case when p_payload->>'unit'='mL' then q/1000 else q end,amount,auth.uid())
    on conflict(vehicle_id) do update set quantity=excluded.quantity,measure_unit=excluded.measure_unit,
      liters=excluded.liters,amount=excluded.amount,revision=gen_random_uuid(),updated_by=auth.uid(),updated_at=clock_timestamp()
    returning to_jsonb(inventory_tracker_basecoat.*) into after_row;
  result:=jsonb_build_object('ok',true,'vehicle_id',vid,'revision',after_row->>'revision');
  insert into public.inventory_tracker_simple_events(request_id,business_id,branch_id,vehicle_id,action,payload,before_record,after_record,result,recorded_by)
    values(p_request_id,p_business_id,p_branch_id,vid,'past_basecoat',p_payload,before_row,after_row,result,auth.uid());
  return result;
end; $$;

create or replace function public.inventory_tracker_simple_snapshot(p_business_id uuid,p_branch_id uuid,p_vehicle_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  -- Existing snapshot enforces business/branch read access and vehicle scope.
  result:=public.inventory_tracker_cost_snapshot(p_business_id,p_branch_id,p_vehicle_id);
  return result||jsonb_build_object('simple_pricing_version',1,'past_basecoat_version',1,
    'basecoat',(select to_jsonb(b) from public.inventory_tracker_basecoat b
      where b.vehicle_id=p_vehicle_id and b.business_id=p_business_id and b.branch_id=p_branch_id),
    'basecoat_history',coalesce((select jsonb_agg(to_jsonb(h) order by h.recorded_at desc,h.id desc) from (
      select e.id,e.action,e.payload->>'note' as note,e.before_record,e.after_record,e.recorded_by,e.recorded_at
      from public.inventory_tracker_simple_events e
      where e.vehicle_id=p_vehicle_id and e.business_id=p_business_id and e.branch_id=p_branch_id
        and e.action in ('basecoat','basecoat_remove','past_basecoat')
      order by e.recorded_at desc,e.id desc limit 100
    ) h),'[]'::jsonb));
end; $$;
revoke all on function public.inventory_tracker_archive_basecoat_save(uuid,uuid,uuid,jsonb),
  public.inventory_tracker_simple_snapshot(uuid,uuid,uuid) from public,anon;
grant execute on function public.inventory_tracker_archive_basecoat_save(uuid,uuid,uuid,jsonb),
  public.inventory_tracker_simple_snapshot(uuid,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
