-- 15M only: atomic PO receipt -> Expenses + current Inventory Tracker.
-- No backfill, stock reset, price overwrite, or change to legacy inventory sync.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$ begin
  if not exists(select 1 from pg_trigger where tgrelid='public.expenses'::regclass and tgname='expenses_sync_inventory_stock_in' and tgenabled='O'
    and pg_get_triggerdef(oid) like '%FOR EACH ROW WHEN ((new.business_id <> ''ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875''::uuid)) EXECUTE FUNCTION sync_expense_stock_in()') then
    raise exception 'Verify that update 075 has paused the old inventory for 15M before installing PO receiving.';
  end if;
end; $$;

create table public.purchase_order_receipts (
  purchase_order_id uuid primary key references public.purchase_orders(id) on delete restrict,
  business_id uuid not null references public.businesses(id),
  branch_id uuid not null references public.branches(id),
  receipt_number text not null check(length(trim(receipt_number)) between 1 and 120),
  supplier_key text not null, receipt_key text not null,
  received_by uuid not null references auth.users(id),
  received_at timestamptz not null default clock_timestamp(),
  order_snapshot jsonb not null, result jsonb not null,
  unique(business_id,branch_id,supplier_key,receipt_key)
);
alter table public.expenses add column purchase_order_item_id uuid unique references public.purchase_order_items(id) on delete restrict;
create table public.purchase_order_receipt_lines (
  purchase_order_item_id uuid primary key references public.purchase_order_items(id) on delete restrict,
  purchase_order_id uuid not null references public.purchase_order_receipts(purchase_order_id),
  expense_id uuid not null unique references public.expenses(id) on delete restrict,
  material_id uuid not null references public.inventory_tracker_materials(id) on delete restrict,
  stock_quantity numeric(14,2) not null check(stock_quantity>0), stock_unit text not null, material_name text not null,
  stock_before numeric(14,2) not null, stock_after numeric(14,2) not null
);
alter table public.purchase_order_receipts enable row level security;
alter table public.purchase_order_receipt_lines enable row level security;
create policy purchase_order_receipts_read on public.purchase_order_receipts for select to authenticated
  using(public.can_view_tracker_costs(business_id,branch_id) and public.can_view_expense_branch(business_id,branch_id));
create policy purchase_order_receipt_lines_read on public.purchase_order_receipt_lines for select to authenticated
  using(exists(select 1 from public.purchase_order_receipts r where r.purchase_order_id=purchase_order_receipt_lines.purchase_order_id));
revoke all on public.purchase_order_receipts,public.purchase_order_receipt_lines from public,anon,authenticated;
grant select on public.purchase_order_receipts,public.purchase_order_receipt_lines to authenticated;

create function public.po_receipt_key(v text) returns text language sql immutable set search_path=public as $$
  select regexp_replace(lower(trim(coalesce(v,''))),'[[:space:][:punct:]]','','g');
$$;

create function public.can_receive_tracker_purchase_order(b uuid,r uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and b='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875'::uuid
    and (public.is_platform_admin() or public.is_business_manager(b))
    and public.can_manage_expense_branch(b,r) and public.can_manage_inventory_branch(b,r)
    and public.can_view_tracker_costs(b,r)
    and exists(select 1 from public.branches where id=r and business_id=b and is_active);
$$;

create function public.purchase_order_receive_preview(p_business_id uuid,p_branch_id uuid,p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare po public.purchase_orders%rowtype; items jsonb; snapshot jsonb;
begin
  if not public.can_receive_tracker_purchase_order(p_business_id,p_branch_id) then
    raise exception 'Purchase Orders, Expenses and Inventory edit access is required for this branch.';
  end if;
  select * into po from public.purchase_orders where id=p_order_id and business_id=p_business_id and branch_id=p_branch_id;
  if not found then raise exception 'Purchase order is unavailable in this branch.'; end if;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) into items from public.purchase_order_items i where purchase_order_id=po.id;
  snapshot:=to_jsonb(po)||jsonb_build_object('purchase_order_items',items);
  return jsonb_build_object('version',1,'order',snapshot,'revision',md5(snapshot::text),
    'materials',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'item_name',m.item_name,'quantity',m.quantity,
      'stock_unit',coalesce(p.price_unit,nullif(m.measure_unit,''),'stock unit')) order by m.item_name,m.id)
      from public.inventory_tracker_materials m left join public.inventory_tracker_reference_prices p on p.material_id=m.id
      where m.business_id=p_business_id and m.branch_id=p_branch_id),'[]'::jsonb));
end; $$;

-- Cached clients must not use the old non-atomic receive path. Received records
-- cannot be edited/reopened/deleted, and item edits serialize with the PO lock.
create function public.guard_tracker_purchase_order() returns trigger
language plpgsql security definer set search_path=public as $$
declare parent public.purchase_orders%rowtype;
begin
  if tg_table_name='purchase_order_items' then
    select * into parent from public.purchase_orders where id=case when tg_op='DELETE' then old.purchase_order_id else new.purchase_order_id end for update;
    if parent.business_id='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875'::uuid then
      if parent.status='Received' then raise exception 'Received purchase order items are read-only.'; end if;
    end if;
    if tg_op='UPDATE' and old.purchase_order_id<>new.purchase_order_id then raise exception 'An order item cannot be moved to another purchase order.'; end if;
  else
    if tg_op<>'INSERT' and old.business_id='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875'::uuid then
      if old.status='Received' then raise exception 'Received purchase orders are read-only. Do not receive them again.'; end if;
      if tg_op='UPDATE' and (old.business_id<>new.business_id or old.branch_id<>new.branch_id) then raise exception 'A purchase order cannot move to another branch.'; end if;
    end if;
    if tg_op<>'DELETE' and new.business_id='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875'::uuid and new.status='Received'
      and not exists(select 1 from public.purchase_order_receipts where purchase_order_id=new.id) then
      raise exception 'Refresh BWC and use Receive items to save the receipt, Expenses and Inventory Tracker together.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;
create trigger guard_tracker_purchase_order before insert or update or delete on public.purchase_orders
  for each row execute function public.guard_tracker_purchase_order();
create trigger guard_tracker_purchase_order_item before insert or update or delete on public.purchase_order_items
  for each row execute function public.guard_tracker_purchase_order();

create function public.guard_tracker_receipt_expense() returns trigger
language plpgsql security definer set search_path=public as $$
declare receipt_po uuid;
begin
  if tg_op<>'INSERT' and old.purchase_order_item_id is not null then
    raise exception 'This expense is linked to a received purchase order. Ask the owner to review a correction; do not delete or duplicate it.';
  end if;
  if tg_op='DELETE' then return old; end if;
  if new.business_id='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875'::uuid then
    if new.purchase_order_item_id is not null and tg_op<>'INSERT' then raise exception 'A manual expense cannot be relinked to a received PO.'; end if;
    if trim(coalesce(new.receipt_number,''))<>'' then
      perform pg_advisory_xact_lock(hashtextextended(new.business_id::text||':'||new.branch_id::text||':'||public.po_receipt_key(new.supplier_name)||':'||public.po_receipt_key(new.receipt_number),0));
      select purchase_order_id into receipt_po from public.purchase_order_receipts where business_id=new.business_id and branch_id=new.branch_id
        and supplier_key=public.po_receipt_key(new.supplier_name) and receipt_key=public.po_receipt_key(new.receipt_number);
    end if;
    if new.purchase_order_item_id is not null then
      if receipt_po is null or not exists(select 1 from public.purchase_order_items i where i.id=new.purchase_order_item_id and i.purchase_order_id=receipt_po) then
        raise exception 'A valid confirmed PO receipt is required for this expense.';
      end if;
    elsif receipt_po is not null then
      raise exception 'This supplier receipt was already recorded through Purchase Orders. Do not encode it again in Expenses.';
    elsif new.remarks='Received purchase order' then
      raise exception 'Refresh BWC and use the updated Receive items button. Nothing has been received.';
    end if;
  elsif new.purchase_order_item_id is not null then raise exception 'PO receipt links cannot cross businesses.';
  end if;
  return new;
end; $$;
create trigger guard_tracker_receipt_expense before insert or update or delete on public.expenses
  for each row execute function public.guard_tracker_receipt_expense();

create function public.receive_purchase_order_to_tracker(p_business_id uuid,p_branch_id uuid,p_order_id uuid,p_revision text,p_receipt_number text,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  po public.purchase_orders%rowtype; prior public.purchase_order_receipts%rowtype;
  m public.inventory_tracker_materials%rowtype; line public.purchase_order_items%rowtype;
  preview jsonb; entry jsonb; receipt_result jsonb; before_row jsonb; after_row jsonb;
  receipt text:=trim(coalesce(p_receipt_number,'')); mid uuid; eid uuid; qty numeric; total_cost numeric;
  stock_unit text; expense_count int:=0; stock_count int:=0;
begin
  if not public.can_receive_tracker_purchase_order(p_business_id,p_branch_id) then
    raise exception 'Purchase Orders, Expenses and Inventory edit access is required for this branch.';
  end if;
  select * into po from public.purchase_orders where id=p_order_id and business_id=p_business_id and branch_id=p_branch_id for update;
  if not found then raise exception 'Purchase order is unavailable in this branch.'; end if;
  select * into prior from public.purchase_order_receipts where purchase_order_id=po.id;
  if found then return prior.result||jsonb_build_object('duplicate',true); end if;
  if po.status<>'Approved' then raise exception 'Only Approved orders can be received. Previously Received orders are not added to stock again.'; end if;
  if length(receipt) not between 1 and 120 or public.po_receipt_key(receipt)='' then raise exception 'Enter the supplier receipt number (1–120 characters).'; end if;
  preview:=public.purchase_order_receive_preview(p_business_id,p_branch_id,p_order_id);
  if p_revision is distinct from preview->>'revision' then raise exception 'The order changed. Close this window and review Receive items again.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Review the inventory destination for every order item.'; end if;
  if jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)<>jsonb_array_length(preview->'order'->'purchase_order_items')
    or (select count(distinct x->>'item_id') from jsonb_array_elements(p_lines) x)<>jsonb_array_length(p_lines)
    or exists(select 1 from jsonb_array_elements(p_lines) x where not exists(select 1 from public.purchase_order_items i where i.id::text=x->>'item_id' and i.purchase_order_id=po.id)) then
    raise exception 'Every order item must have exactly one inventory decision.';
  end if;
  -- Same supplier receipt serializes across POs and manual Expenses inserts.
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':'||p_branch_id::text||':'||public.po_receipt_key(po.supplier_name)||':'||public.po_receipt_key(receipt),0));
  if exists(select 1 from public.expenses e where e.business_id=p_business_id and e.branch_id=p_branch_id and
    ((e.reference_number=po.po_number and e.remarks='Received purchase order') or
     (public.po_receipt_key(e.supplier_name)=public.po_receipt_key(po.supplier_name) and public.po_receipt_key(e.receipt_number)=public.po_receipt_key(receipt)))) then
    raise exception 'Expenses already exist for this PO or supplier receipt. Nothing was added. Ask the owner to reconcile the existing entries first.';
  end if;
  if exists(select 1 from public.purchase_order_receipts where business_id=p_business_id and branch_id=p_branch_id and supplier_key=public.po_receipt_key(po.supplier_name) and receipt_key=public.po_receipt_key(receipt)) then
    raise exception 'This supplier receipt has already been received on another PO.';
  end if;
  -- Deterministic material locking prevents cross-PO lost updates/deadlocks.
  perform 1 from public.inventory_tracker_materials where business_id=p_business_id and branch_id=p_branch_id
    and id in(select nullif(x->>'material_id','')::uuid from jsonb_array_elements(p_lines) x) order by id for update;
  insert into public.purchase_order_receipts(purchase_order_id,business_id,branch_id,receipt_number,supplier_key,receipt_key,received_by,order_snapshot,result)
    values(po.id,p_business_id,p_branch_id,receipt,public.po_receipt_key(po.supplier_name),public.po_receipt_key(receipt),auth.uid(),preview->'order','{}');
  for line in select * from public.purchase_order_items where purchase_order_id=po.id order by id loop
    if line.quantity::text in ('NaN','Infinity','-Infinity') or line.unit_cost::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid order quantity or price.'; end if;
    select x into entry from jsonb_array_elements(p_lines) x where x->>'item_id'=line.id::text;
    mid:=nullif(entry->>'material_id','')::uuid; qty:=null; stock_unit:=null; before_row:=null; after_row:=null;
    if mid is null then raise exception 'Every PO item must be linked to an Inventory Tracker material before receiving.'; end if;
      select * into m from public.inventory_tracker_materials where id=mid and business_id=p_business_id and branch_id=p_branch_id;
      if not found then raise exception 'The selected Inventory Tracker material is unavailable in this branch.'; end if;
      select coalesce((select price_unit from public.inventory_tracker_reference_prices where material_id=m.id),nullif(m.measure_unit,''),'stock unit') into stock_unit;
      if entry->>'stock_unit' is distinct from stock_unit or entry->>'material_name' is distinct from m.item_name then raise exception 'The inventory item or its package unit changed. Reopen Receive items and review it.'; end if;
      qty:=(entry->>'quantity')::numeric;
      if qty is null or qty::text in ('NaN','Infinity','-Infinity') or qty<=0 or qty>999999999 or qty<>round(qty,2) or m.quantity+qty>999999999 then
        raise exception 'Enter a positive stock quantity with up to two decimal places.';
      end if;
      before_row:=to_jsonb(m); total_cost:=round(line.quantity*line.unit_cost,6);
      update public.inventory_tracker_materials set quantity=quantity+qty,
        cost_value=case when cost_initialized then cost_value+total_cost else null end,updated_by=auth.uid()
        where id=mid returning to_jsonb(inventory_tracker_materials.*) into after_row;
      -- The saved reference price stays unchanged; no historical usage is repriced.
      insert into public.inventory_tracker_simple_events(request_id,business_id,branch_id,material_id,action,payload,before_record,after_record,result,recorded_by)
        values(line.id,p_business_id,p_branch_id,mid,'po_receive',entry||jsonb_build_object('purchase_order_id',po.id,'po_number',po.po_number,'receipt_number',receipt,'purchase_amount',total_cost),before_row,after_row,jsonb_build_object('ok',true),auth.uid());
      stock_count:=stock_count+1;
    insert into public.expenses(business_id,branch_id,expense_date,supplier_name,receipt_number,category,description,quantity,unit_amount,payment_method,reference_number,remarks,created_by,purchase_order_item_id)
      values(p_business_id,p_branch_id,(clock_timestamp() at time zone 'Asia/Manila')::date,po.supplier_name,receipt,line.category,line.description,line.quantity,line.unit_cost,po.payment_method,po.po_number,'Received purchase order',auth.uid(),line.id) returning id into eid;
    insert into public.purchase_order_receipt_lines(purchase_order_item_id,purchase_order_id,expense_id,material_id,stock_quantity,stock_unit,material_name,stock_before,stock_after)
      values(line.id,po.id,eid,mid,qty,stock_unit,m.item_name,(before_row->>'quantity')::numeric,(after_row->>'quantity')::numeric);
    expense_count:=expense_count+1;
  end loop;
  update public.purchase_orders set status='Received',received_at=clock_timestamp() where id=po.id;
  receipt_result:=jsonb_build_object('ok',true,'po_number',po.po_number,'receipt_number',receipt,'expense_count',expense_count,'stock_line_count',stock_count);
  update public.purchase_order_receipts set result=receipt_result where purchase_order_id=po.id;
  return receipt_result;
end; $$;
revoke all on function public.can_receive_tracker_purchase_order(uuid,uuid),public.purchase_order_receive_preview(uuid,uuid,uuid),
  public.receive_purchase_order_to_tracker(uuid,uuid,uuid,text,text,jsonb),public.guard_tracker_purchase_order(),public.guard_tracker_receipt_expense() from public,anon;
grant execute on function public.can_receive_tracker_purchase_order(uuid,uuid),public.purchase_order_receive_preview(uuid,uuid,uuid),
  public.receive_purchase_order_to_tracker(uuid,uuid,uuid,text,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
