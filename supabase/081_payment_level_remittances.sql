-- Remittance belongs to a payment, never to an invoice's cumulative paid total.
-- Existing financial records are not rewritten. Unallocated legacy records keep
-- their original values and conservatively protect the payments present at cutover.
begin;

alter table public.cash_collections add column if not exists payment_id uuid
  references public.invoice_payments(id) on delete cascade;
alter table public.cash_collections drop constraint if exists cash_collections_invoice_id_key;
create unique index if not exists cash_collections_payment_key on public.cash_collections(payment_id);
create unique index if not exists cash_collections_legacy_invoice_key
  on public.cash_collections(invoice_id) where payment_id is null;

create table if not exists public.cash_collection_legacy_payments (
  collection_id uuid not null references public.cash_collections(id) on delete cascade,
  payment_id uuid not null references public.invoice_payments(id) on delete cascade,
  primary key(collection_id,payment_id)
);
alter table public.cash_collection_legacy_payments enable row level security;
revoke all on public.cash_collection_legacy_payments from public, anon, authenticated;
-- Run exactly once: a later migration rerun must not classify new installments
-- as having been covered by an earlier legacy remittance.
do $$ begin
  if not exists (select 1 from pg_trigger where tgname='payment_remittance_sync' and not tgisinternal) then
    insert into public.cash_collection_legacy_payments(collection_id,payment_id)
    select c.id,p.id from public.cash_collections c join public.invoice_payments p on p.invoice_id=c.invoice_id
    where c.payment_id is null on conflict do nothing;
  end if;
end $$;

-- Stop the old header trigger from replacing a remitted amount with amount_paid.
-- Current online and offline invoice creation both write dated payment rows.
create or replace function public.sync_invoice_cash_collection()
returns trigger language plpgsql security definer set search_path=public as $$
begin return new; end;
$$;

create or replace function public.invoice_payment_is_remitted(p_invoice_id uuid,p_payment_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.cash_collections c
    where c.invoice_id=p_invoice_id and c.status='Remitted'
      and (p_payment_id is null or c.payment_id=p_payment_id or
        (c.payment_id is null and (
          exists(select 1 from public.cash_collection_legacy_payments l where l.collection_id=c.id and l.payment_id=p_payment_id)
          or (not exists(select 1 from public.cash_collection_legacy_payments l where l.collection_id=c.id)
              and not exists(select 1 from public.cash_collections own where own.payment_id=p_payment_id))
        )))
  );
$$;
revoke all on function public.invoice_payment_is_remitted(uuid,uuid) from public, anon, authenticated;

create or replace function public.guard_invoice_payment_remittance()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_invoice public.invoices%rowtype; c public.cash_collections%rowtype;
begin
  select * into v_invoice from public.invoices where id=case when tg_op='DELETE' then old.invoice_id else new.invoice_id end for update;
  if tg_op<>'DELETE' and (v_invoice.id is null or new.business_id<>v_invoice.business_id or new.branch_id<>v_invoice.branch_id) then
    raise exception 'Payment must belong to its invoice business and branch.';
  end if;
  if tg_op='UPDATE' and (new.id<>old.id or new.invoice_id<>old.invoice_id or new.business_id<>old.business_id or new.branch_id<>old.branch_id or new.created_at<>old.created_at) then
    raise exception 'A payment cannot be moved or re-identified.';
  end if;
  if tg_op<>'INSERT' and public.invoice_payment_is_remitted(old.invoice_id,old.id) then
    raise exception 'This specific payment is covered by a recorded remittance. Preserve it and request an owner-reviewed adjustment.';
  end if;
  if tg_op='DELETE' and lower(trim(old.payment_method))='cash' then
    select x.* into c from public.cash_collections x join public.cash_collection_legacy_payments l on l.collection_id=x.id
    where l.payment_id=old.id and x.payment_id is null for update of x;
    if found then
      if c.amount<old.amount then raise exception 'Legacy cash collection needs reconciliation first.'; end if;
      if c.amount=old.amount then delete from public.cash_collections where id=c.id;
      else update public.cash_collections set amount=amount-old.amount,updated_at=now() where id=c.id; end if;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists payment_remittance_guard on public.invoice_payments;
create trigger payment_remittance_guard before insert or update or delete on public.invoice_payments
for each row execute function public.guard_invoice_payment_remittance();

create or replace function public.sync_payment_remittance()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_legacy public.cash_collections%rowtype; v_delta numeric; v_invoice public.invoices%rowtype;
begin
  if tg_op='DELETE' then return old; end if;
  select * into v_invoice from public.invoices where id=new.invoice_id;
  select c.* into v_legacy from public.cash_collections c join public.cash_collection_legacy_payments l on l.collection_id=c.id
  where l.payment_id=new.id and c.payment_id is null for update of c;
  if found then
    -- Keep unrelated legacy totals unchanged; only apply this payment's cash delta.
    if v_legacy.status='Remitted' then raise exception 'Legacy remittance requires review.'; end if;
    v_delta=(case when lower(trim(new.payment_method))='cash' then new.amount else 0 end)
           -(case when lower(trim(old.payment_method))='cash' then old.amount else 0 end);
    if v_legacy.amount+v_delta<0 then raise exception 'Legacy cash collection needs reconciliation first.'; end if;
    if v_legacy.amount+v_delta=0 then delete from public.cash_collections where id=v_legacy.id;
    elsif v_delta<>0 then update public.cash_collections set amount=amount+v_delta,updated_at=now() where id=v_legacy.id;
    end if;
    return new;
  end if;
  if lower(trim(new.payment_method))='cash' then
    insert into public.cash_collections(business_id,branch_id,invoice_id,payment_id,received_date,amount,received_by)
    values(new.business_id,new.branch_id,new.invoice_id,new.id,new.payment_date,new.amount,coalesce(new.received_by,v_invoice.assigned_admin))
    on conflict(payment_id) do update set amount=excluded.amount,received_date=excluded.received_date,received_by=excluded.received_by,updated_at=now()
    where cash_collections.status='Pending remittance';
  else
    delete from public.cash_collections where payment_id=new.id and status='Pending remittance';
  end if;
  return new;
end;
$$;
drop trigger if exists payment_remittance_sync on public.invoice_payments;
create trigger payment_remittance_sync after insert or update on public.invoice_payments
for each row execute function public.sync_payment_remittance();
drop trigger if exists audit_invoice_payments on public.invoice_payments;
create trigger audit_invoice_payments after insert or update or delete on public.invoice_payments
for each row execute function public.capture_business_audit();

-- Protect the collection itself, including calls from older cached clients.
create or replace function public.guard_cash_remittance_record()
returns trigger language plpgsql security definer set search_path=public as $$
declare p public.invoice_payments%rowtype;
begin
  -- Direct database-owner maintenance is still possible and is captured by the
  -- existing audit trigger. Browser clients have no unauthenticated write policy.
  if auth.uid() is null then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op<>'INSERT' and old.status='Remitted' then
    if tg_op='DELETE' or to_jsonb(new)-'updated_at' is distinct from to_jsonb(old)-'updated_at' then
      raise exception 'Recorded remittances cannot be overwritten or erased.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  if tg_op='UPDATE' and (new.id<>old.id or new.business_id<>old.business_id or new.branch_id<>old.branch_id or new.invoice_id<>old.invoice_id or new.payment_id is distinct from old.payment_id) then
    raise exception 'A remittance cannot be moved to another payment or branch.';
  end if;
  if new.payment_id is not null then
    select * into p from public.invoice_payments where id=new.payment_id;
    if not found or p.invoice_id<>new.invoice_id or p.branch_id<>new.branch_id or p.business_id<>new.business_id
       or lower(trim(p.payment_method))<>'cash' or p.amount<>new.amount or p.payment_date<>new.received_date then
      raise exception 'Remittance must match the exact cash payment.';
    end if;
  end if;
  if new.status='Remitted' and (tg_op='INSERT' or old.status<>'Remitted') then
    if new.payment_id is null then raise exception 'Review and allocate this older invoice-level record before marking it remitted.'; end if;
    if not public.can_manage_invoice_branch(new.business_id,new.branch_id) or
       not (public.is_platform_admin() or public.is_business_manager(new.business_id)) then
      raise exception 'Only an authorized manager can record this branch remittance.';
    end if;
    new.remitted_at=clock_timestamp(); new.remitted_by=auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists cash_remittance_record_guard on public.cash_collections;
create trigger cash_remittance_record_guard before insert or update or delete on public.cash_collections
for each row execute function public.guard_cash_remittance_record();

create or replace function public.mark_payment_remitted(p_collection_id uuid,p_branch_id uuid,p_expected_amount numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.cash_collections%rowtype; v_invoice_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to record a remittance.'; end if;
  select invoice_id into v_invoice_id from public.cash_collections where id=p_collection_id and branch_id=p_branch_id;
  perform 1 from public.invoices where id=v_invoice_id for update;
  select * into c from public.cash_collections where id=p_collection_id and branch_id=p_branch_id for update;
  if not found then raise exception 'Cash payment not found in this branch.'; end if;
  if not public.can_manage_invoice_branch(c.business_id,p_branch_id) or not (public.is_platform_admin() or public.is_business_manager(c.business_id)) then
    raise exception 'You cannot record remittances in this branch.';
  end if;
  if c.payment_id is null then raise exception 'Review this older invoice-level record first.'; end if;
  if p_expected_amount is null or c.amount<>p_expected_amount then raise exception 'This payment changed. Reload before recording remittance.'; end if;
  if c.status='Remitted' then return jsonb_build_object('ok',true,'already_recorded',true); end if;
  update public.cash_collections set status='Remitted',remitted_at=clock_timestamp(),remitted_by=auth.uid(),updated_at=now() where id=c.id;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.mark_payment_remitted(uuid,uuid,numeric) from public,anon;
grant execute on function public.mark_payment_remitted(uuid,uuid,numeric) to authenticated;
-- Force browser remittance writes through the RPC's invoice-first lock order.
-- This closes a race between an old browser's direct update and a correction.
revoke insert,update,delete on public.cash_collections from authenticated,anon;

-- Retain all existing permission, balance, reason, branch and audit checks.
do $patch$
declare definition text; old_check text := $old$if exists (
    select 1 from public.cash_collections collection
    where collection.invoice_id = v_invoice.id
      and collection.status = 'Remitted'
  ) then$old$;
begin
  select pg_get_functiondef('public.correct_invoice_payment(uuid,uuid,numeric,uuid,date,text,text,text,text)'::regprocedure) into definition;
  if position(old_check in definition)>0 then
    definition=replace(definition,old_check,'if public.invoice_payment_is_remitted(v_invoice.id, p_payment_id) then');
    definition=replace(definition,'This invoice has already been remitted. Record a separate correcting transaction instead.',
      'This selected payment is covered by a recorded remittance. Request an owner-reviewed adjustment.');
    execute definition;
  elsif position('invoice_payment_is_remitted(v_invoice.id, p_payment_id)' in definition)=0 then
    raise exception 'Unexpected correction function. Migration stopped without changes.';
  end if;
end;
$patch$;

-- Preserve existing, unchanged CIB row IDs (especially previously remitted cash).
create or replace function public.sync_invoice_payment_cash(p_invoice_id uuid,p_branch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_invoice public.invoices%rowtype; v_rows integer;
begin
  select * into v_invoice from public.invoices where id=p_invoice_id and branch_id=p_branch_id for update;
  if not found then raise exception 'Invoice was not found in the selected branch.'; end if;
  if auth.uid() is not null and not public.can_manage_invoice_branch(v_invoice.business_id,p_branch_id) then
    raise exception 'You do not have permission to update invoice payments in this branch.';
  end if;
  delete from public.cash_transactions c where c.business_id=v_invoice.business_id and c.branch_id=p_branch_id
    and (c.source_key='invoice-cash:'||v_invoice.id::text or
      (c.source_key like 'invoice-payment-cash:'||v_invoice.id::text||':%' and not exists(
        select 1 from public.invoice_payments p where p.invoice_id=v_invoice.id and lower(trim(p.payment_method))='cash'
          and c.source_key='invoice-payment-cash:'||v_invoice.id::text||':'||p.id::text)));
  insert into public.cash_transactions(business_id,branch_id,cash_account,direction,amount,transaction_date,source_key,reference_number,notes,created_by)
  select v_invoice.business_id,p_branch_id,'CIB','In',p.amount,p.payment_date,
    'invoice-payment-cash:'||v_invoice.id::text||':'||p.id::text,'INV-'||lpad(v_invoice.invoice_number::text,5,'0'),
    'Cash payment for invoice - '||coalesce(v_invoice.client_name,'Client'),p.created_by
  from public.invoice_payments p where p.invoice_id=v_invoice.id and p.business_id=v_invoice.business_id and p.branch_id=p_branch_id and lower(trim(p.payment_method))='cash'
  on conflict(branch_id,source_key) do update set amount=excluded.amount,transaction_date=excluded.transaction_date
    where cash_transactions.amount is distinct from excluded.amount or cash_transactions.transaction_date is distinct from excluded.transaction_date;
  get diagnostics v_rows=row_count;
  return jsonb_build_object('ok',true,'cash_records_synced',v_rows);
end;
$$;
commit;
