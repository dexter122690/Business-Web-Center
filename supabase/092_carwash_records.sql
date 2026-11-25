-- Separate carwash monitoring and receipts. LOCAL PREVIEW ONLY; not yet deployed.
begin;

create table if not exists public.carwash_records (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  service_date date not null,
  unit text not null check(length(btrim(unit)) between 1 and 160),
  plate_number text not null check(length(btrim(plate_number)) between 1 and 40),
  price numeric(12,2) check(price > 0),
  status text not null default 'ongoing' check(status in ('ongoing','done')),
  completed_at timestamptz,
  arrived_at timestamptz,
  elapsed_seconds bigint,
  payment_date date,
  paid_at timestamptz,
  paid_by uuid references auth.users(id),
  revision integer not null default 1 check(revision > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id)
);
-- Permit upgrading the earlier local preview without clearing its records.
-- Preserve older unpriced preview rows; all new saves/edits require a price in the RPC.
alter table public.carwash_records alter column price drop not null;
alter table public.carwash_records add column if not exists status text not null default 'ongoing' check(status in ('ongoing','done'));
alter table public.carwash_records add column if not exists completed_at timestamptz;
alter table public.carwash_records add column if not exists arrived_at timestamptz;
alter table public.carwash_records add column if not exists elapsed_seconds bigint;
-- Do not invent exact arrival times for existing or backdated entries.
alter table public.carwash_records drop constraint if exists carwash_timing_valid;
alter table public.carwash_records add constraint carwash_timing_valid check (
  (arrived_at is null and elapsed_seconds is null) or
  (arrived_at is not null and service_date=(arrived_at at time zone 'Asia/Manila')::date and
    ((status='ongoing' and completed_at is null and elapsed_seconds is null) or
     (status='done' and completed_at is not null and completed_at>=arrived_at and elapsed_seconds is not null and
      elapsed_seconds=floor(extract(epoch from completed_at-arrived_at))::bigint)))
);
alter table public.carwash_records add column if not exists payment_date date;
alter table public.carwash_records add column if not exists paid_at timestamptz;
alter table public.carwash_records add column if not exists paid_by uuid references auth.users(id);
-- No automatic conversion from quoted price to payment. Staff must confirm paid.
alter table public.carwash_records drop constraint if exists carwash_payment_valid;
alter table public.carwash_records add constraint carwash_payment_valid check (
  (payment_date is null and paid_at is null and paid_by is null) or
  (payment_date is not null and price is not null and price > 0 and payment_date >= service_date and paid_at is not null and paid_by is not null)
);
create index if not exists carwash_branch_date_idx on public.carwash_records(business_id,branch_id,service_date,id) where voided_at is null;

create table if not exists public.carwash_events (
  request_id uuid primary key,
  business_id uuid not null references public.businesses(id),
  branch_id uuid not null references public.branches(id),
  record_id uuid not null references public.carwash_records(id),
  actor_id uuid not null references auth.users(id),
  payload jsonb not null,
  before_record jsonb,
  after_record jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.carwash_records enable row level security;
alter table public.carwash_events enable row level security;
drop policy if exists carwash_read on public.carwash_records;
create policy carwash_read on public.carwash_records for select to authenticated
  using(public.can_view_invoice_branch(business_id,branch_id));
drop policy if exists carwash_audit_read on public.carwash_events;
create policy carwash_audit_read on public.carwash_events for select to authenticated
  using(public.is_business_owner(business_id));
revoke all on public.carwash_records,public.carwash_events from public,anon,authenticated;
grant select on public.carwash_records,public.carwash_events to authenticated;

create or replace function public.carwash_access(p_business_id uuid,p_branch_id uuid)
returns jsonb language sql volatile security definer set search_path=public as $$
  select jsonb_build_object('server_now',clock_timestamp(),'can_view',auth.uid() is not null and public.can_view_invoice_branch(p_business_id,p_branch_id),
    'can_edit',auth.uid() is not null and public.can_manage_invoice_branch(p_business_id,p_branch_id),
    'can_void',auth.uid() is not null and public.is_business_owner(p_business_id))
  where exists(select 1 from public.branches where id=p_branch_id and business_id=p_business_id and is_active);
$$;

create or replace function public.save_carwash_record(p_business_id uuid,p_branch_id uuid,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare previous public.carwash_records%rowtype; saved public.carwash_records%rowtype;
  event public.carwash_events%rowtype; record_id uuid; expected integer; action text;
  before_value jsonb; price_value numeric; date_value date; unit_value text; plate_value text; event_time timestamptz;
begin
  if auth.uid() is null or not coalesce(public.can_manage_invoice_branch(p_business_id,p_branch_id),false)
     or not exists(select 1 from public.branches where id=p_branch_id and business_id=p_business_id and is_active)
     then raise exception 'Carwash edit access is required for this branch'; end if;
  if p_request_id is null or p_payload is null then raise exception 'Missing save request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into event from public.carwash_events where request_id=p_request_id;
  if found then
    if event.business_id<>p_business_id or event.branch_id<>p_branch_id or event.actor_id<>auth.uid() or event.payload<>p_payload
       then raise exception 'This request was already used for a different operation'; end if;
    return event.after_record;
  end if;
  record_id:=(p_payload->>'id')::uuid; expected:=(p_payload->>'revision')::integer; action:=p_payload->>'action';
  if record_id is null or expected is null or expected<0 or action is null or action not in ('save','void','done','reopen','paid') then raise exception 'Invalid record request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(record_id::text,1));
  select * into previous from public.carwash_records where id=record_id for update;
  if found then
    if previous.business_id<>p_business_id or previous.branch_id<>p_branch_id then raise exception 'Record is unavailable in this branch'; end if;
    if previous.revision<>expected or previous.voided_at is not null then raise exception 'Record changed. Reload before editing'; end if;
    before_value:=to_jsonb(previous);
  elsif expected<>0 or action<>'save' then raise exception 'Record is unavailable';
  end if;
  event_time:=clock_timestamp();
  if action='void' then
    if not coalesce(public.is_business_owner(p_business_id),false) then raise exception 'Only the owner can void a carwash record'; end if;
    update public.carwash_records set voided_at=clock_timestamp(),voided_by=auth.uid(),updated_at=clock_timestamp(),revision=revision+1
      where id=record_id returning * into saved;
  elsif action='paid' then
    if previous.payment_date is not null then raise exception 'Already paid. Reload before editing'; end if;
    if previous.price is null or previous.price<=0 then raise exception 'Save the price first before marking paid'; end if;
    if coalesce(p_payload->>'payment_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter a valid payment date'; end if;
    date_value:=(p_payload->>'payment_date')::date;
    if date_value<previous.service_date or date_value>(clock_timestamp() at time zone 'Asia/Manila')::date then raise exception 'Payment date must be between arrival date and today'; end if;
    update public.carwash_records set payment_date=date_value,paid_at=clock_timestamp(),paid_by=auth.uid(),
      updated_at=clock_timestamp(),revision=revision+1 where id=record_id returning * into saved;
  elsif action in ('done','reopen') then
    if (action='done' and previous.status='done') or (action='reopen' and previous.status='ongoing') then raise exception 'Status already changed. Reload before editing'; end if;
    update public.carwash_records set status=case when action='done' then 'done' else 'ongoing' end,
      completed_at=case when action='done' then event_time else null end,
      elapsed_seconds=case when action='done' and previous.arrived_at is not null then floor(extract(epoch from event_time-previous.arrived_at))::bigint else null end,
      updated_at=clock_timestamp(),revision=revision+1 where id=record_id returning * into saved;
  else
    unit_value:=btrim(p_payload->>'unit'); plate_value:=upper(btrim(p_payload->>'plate_number'));
    if unit_value is null or length(unit_value) not between 1 and 160 or plate_value is null or length(plate_value) not between 1 and 40 then raise exception 'Enter the unit and plate number'; end if;
    if coalesce(p_payload->>'service_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter a valid carwash date'; end if;
    date_value:=(p_payload->>'service_date')::date;
    if date_value>(clock_timestamp() at time zone 'Asia/Manila')::date then raise exception 'Future carwash records are not allowed'; end if;
    if nullif(btrim(p_payload->>'price'),'') is null then raise exception 'Enter the price upon arrival before saving this unit'; end if;
    if (p_payload->>'price') !~ '^\d+(\.\d{1,2})?$' then raise exception 'Enter a valid price with at most two decimal places'; end if;
    price_value:=(p_payload->>'price')::numeric;
    if price_value<=0 or price_value>9999999999.99 then raise exception 'Price must be greater than zero'; end if;
    if previous.id is null then
      insert into public.carwash_records(id,business_id,branch_id,service_date,unit,plate_number,price,created_by,arrived_at)
      values(record_id,p_business_id,p_branch_id,date_value,unit_value,plate_value,price_value,auth.uid(),
        case when date_value=(event_time at time zone 'Asia/Manila')::date then event_time else null end) returning * into saved;
    else
      if previous.arrived_at is not null and previous.service_date is distinct from date_value then raise exception 'Recorded arrival date and time are locked'; end if;
      if previous.payment_date is not null and (previous.price is distinct from price_value or previous.service_date is distinct from date_value) then raise exception 'Paid price and arrival date are locked. Ask the owner to correct the record'; end if;
      update public.carwash_records set service_date=date_value,unit=unit_value,plate_number=plate_value,price=price_value,
        revision=revision+1,updated_at=clock_timestamp() where id=record_id returning * into saved;
    end if;
  end if;
  insert into public.carwash_events(request_id,business_id,branch_id,record_id,actor_id,payload,before_record,after_record)
  values(p_request_id,p_business_id,p_branch_id,record_id,auth.uid(),p_payload,before_value,to_jsonb(saved));
  return to_jsonb(saved);
end;
$$;
revoke all on function public.carwash_access(uuid,uuid) from public,anon;
revoke all on function public.save_carwash_record(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.carwash_access(uuid,uuid),public.save_carwash_record(uuid,uuid,uuid,jsonb) to authenticated;
commit;
