const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {setup,ids}=require('./helpers/inventory-cost-db.cjs');
const read=f=>fs.readFileSync(path.join(__dirname,'../supabase',f),'utf8');
const sql=read('094_purchase_order_tracker_receiving.sql');
test('PO receiving is additive, locked, branch-scoped and does not unpause old inventory',()=>{
  assert.match(sql,/for update/);assert.match(sql,/purchase_order_id uuid primary key/);
  assert.match(sql,/unique\(business_id,branch_id,supplier_key,receipt_key\)/);
  assert.match(sql,/can_manage_expense_branch/);assert.match(sql,/can_manage_inventory_branch/);
  assert.doesNotMatch(sql,/update public.inventory_tracker_reference_prices|insert into public.inventory_stock_movements|delete from public.expenses/i);
});
test('atomic PO receiving in isolated PostgreSQL',{skip:!process.env.BWC_PGLITE_PATH},async t=>{
  const f=await setup(),db=f.db;
  let serial=0;
  const query=(s,p)=>db.query(s,p).then(r=>r.rows);
  const scalar=async(s,p)=>{const v=Object.values((await query(s,p))[0])[0];return typeof v==='string'&&/^\d+(\.\d+)?$/.test(v)?Number(v):v};
  const preview=po=>scalar('select purchase_order_receive_preview($1,$2,$3)',[ids.business,ids.branch,po]);
  const stock=()=>scalar('select quantity from inventory_tracker_materials where id=$1',[ids.material]);
  const totals=()=>query('select (select count(*) from expenses) expenses,(select count(*) from purchase_order_receipts) receipts,(select count(*) from inventory_tracker_simple_events) events');
  async function order(count=1){
    const po=crypto.randomUUID();
    await db.query(`insert into purchase_orders(id,business_id,branch_id,po_number,supplier_name,status,created_by) values($1,$2,$3,$4,'Fictional supplier','Approved',$5)`,[po,ids.business,ids.branch,String(++serial),ids.user]);
    for(let i=0;i<count;i++)await db.query(`insert into purchase_order_items(purchase_order_id,description,quantity,unit_cost,sort_order) values($1,'Liha 120',5,12,$2)`,[po,i]);
    return po;
  }
  const choices=p=>p.order.purchase_order_items.map(i=>({item_id:i.id,material_id:ids.material,material_name:'Liha 120',stock_unit:'1PC',quantity:5}));
  const receive=(po,p,lines=choices(p),receipt='OR-'+po)=>scalar('select receive_purchase_order_to_tracker($1,$2,$3,$4,$5,$6::jsonb)',[ids.business,ids.branch,po,p.revision,receipt,JSON.stringify(lines)]);
  try{
    await db.exec(read('074_inventory_reference_prices.sql'));await db.exec(read('091_inventory_simple_prices.sql'));
    await db.exec(read('004_expenses.sql'));await db.exec('alter table expenses add column branch_id uuid references branches(id)');
    await db.exec(read('031_purchase_orders.sql'));
    await db.exec(`create function can_manage_expense_branch(b uuid,r uuid) returns boolean language sql stable as $$select is_business_owner(b) or exists(select 1 from business_memberships where business_id=b and user_id=auth.uid() and status='active' and permissions->>'expenses'='edit')$$;
      create function can_view_expense_branch(b uuid,r uuid) returns boolean language sql stable as $$select true$$;
      create table old_inventory_probe(id int);
      create function sync_expense_stock_in() returns trigger language plpgsql as $$begin insert into old_inventory_probe values(1);return new;end$$;
      create trigger expenses_sync_inventory_stock_in after insert or update on expenses for each row when(new.business_id<>'${ids.business}'::uuid) execute function sync_expense_stock_in();
      insert into inventory_tracker_reference_prices(material_id,business_id,branch_id,price,price_unit,note) values('${ids.material}','${ids.business}','${ids.branch}',12,'1PC','Fixture price');`);
    const old=await order();await db.query("update purchase_orders set status='Received' where id=$1",[old]);
    const before=await stock();
    await db.exec(sql.replaceAll('ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875',ids.business));
    await db.exec('grant select,insert,update,delete on purchase_orders,purchase_order_items,expenses to authenticated');
    await t.test('install leaves stock and previously received orders unchanged',async()=>{
      assert.equal(await stock(),before);assert.equal(await scalar('select count(*) from purchase_order_receipts'),0);
      await assert.rejects(receive(old,await preview(old)),/Only Approved/);assert.equal(await stock(),before);
    });
    const po=await order(2),p=await preview(po);
    await t.test('one transaction adds current stock, expenses and receipt links; does not change price/old inventory',async()=>{
      const r=await receive(po,p);assert.equal(r.expense_count,2);assert.equal(r.stock_line_count,2);assert.equal(await stock(),20);
      assert.equal(await scalar('select count(*) from old_inventory_probe'),0);
      assert.equal(await scalar('select price from inventory_tracker_reference_prices'),12);
      assert.equal(await scalar('select cost_initialized from inventory_tracker_materials where id=$1',[ids.material]),false);
      const e=await query('select receipt_number,reference_number,quantity,unit_amount,purchase_order_item_id,expense_date from expenses');
      assert.equal(e.length,2);e.forEach(x=>{assert.equal(x.receipt_number,'OR-'+po);assert.equal(x.reference_number,p.order.po_number);assert.equal(Number(x.quantity),5);assert.equal(Number(x.unit_amount),12);assert.ok(x.purchase_order_item_id)});
      assert.equal(await scalar('select count(*) from purchase_order_receipt_lines'),2);
      assert.equal(await scalar('select status from purchase_orders where id=$1',[po]),'Received');
    });
    await t.test('retries including different payloads cannot add stock/expenses twice',async()=>{
      const before=await totals();const results=await Promise.all([receive(po,p),receive(po,p,[],'different')]);results.forEach(r=>assert.equal(r.duplicate,true));
      assert.deepEqual(await totals(),before);assert.equal(await stock(),20);
    });
    await t.test('same receipt reused on another PO is blocked',async()=>{
      const id=await order(),pr=await preview(id);await assert.rejects(receive(id,pr,choices(pr),'  or-'+po+'  '),/already exist|already been received/);
    });
    await t.test('manual expense with same supplier receipt blocks receiving and a PO receipt blocks later manual duplicate',async()=>{
      await db.query(`insert into expenses(business_id,branch_id,expense_date,supplier_name,receipt_number,category,description,quantity,unit_amount,created_by) values($1,$2,current_date,'Fictional supplier','MANUAL-123','Parts & Materials','Liha 120',1,12,$3)`,[ids.business,ids.branch,ids.user]);
      const id=await order();await db.query("update purchase_orders set supplier_name='FictionalSupplier' where id=$1",[id]);
      const pr=await preview(id);await assert.rejects(receive(id,pr,choices(pr),' manual 123 '),/Expenses already exist/);
      await assert.rejects(db.query(`insert into expenses(business_id,branch_id,expense_date,supplier_name,receipt_number,category,description,unit_amount,created_by) values($1,$2,current_date,'Fictional supplier',$3,'Other','Duplicate',12,$4)`,[ids.business,ids.branch,'OR-'+po,ids.user]),/already recorded through/);
    });
    await t.test('cached client cannot insert legacy PO expenses, mark received, reopen or edit received lines',async()=>{
      const id=await order();
      await assert.rejects(db.query("update purchase_orders set status='Received' where id=$1",[id]),/Refresh BWC/);
      await assert.rejects(db.query("update purchase_orders set status='Approved' where id=$1",[po]),/read-only/);
      await assert.rejects(db.query('delete from purchase_order_items where purchase_order_id=$1',[po]),/read-only/);
      await assert.rejects(db.query(`insert into expenses(business_id,branch_id,expense_date,category,description,unit_amount,remarks,created_by) values($1,$2,current_date,'Other','Legacy',12,'Received purchase order',$3)`,[ids.business,ids.branch,ids.user]),/Refresh BWC/);
      await assert.rejects(db.query('delete from expenses where purchase_order_item_id=$1',[p.order.purchase_order_items[0].id]),/linked to a received/);
    });
    await t.test('stale order details, duplicate/missing/foreign item decisions and bad quantities are rejected',async()=>{
      const id=await order(2),pr=await preview(id),valid=choices(pr),before=await totals();
      for(const bad of [[],[valid[0],valid[0]],[{...valid[0],item_id:crypto.randomUUID()},valid[1]],[{...valid[0],quantity:0},valid[1]],[{...valid[0],quantity:1.001},valid[1]],[{...valid[0],quantity:'NaN'},valid[1]],[{...valid[0],stock_unit:'200PCS'},valid[1]],[{...valid[0],material_name:'Wrong name'},valid[1]]])await assert.rejects(receive(id,pr,bad));
      await db.query("update purchase_order_items set unit_cost=14 where id=$1",[valid[0].item_id]);
      await assert.rejects(receive(id,pr),/order changed/);assert.deepEqual(await totals(),before);
    });
    await t.test('late line validation failure rolls back earlier stock, expense and audit writes',async()=>{
      const id=await order(2),pr=await preview(id),lines=choices(pr),before=await totals(),q=await stock();
      lines[1]={item_id:lines[1].item_id,material_id:null,skip_reason:''};
      await assert.rejects(receive(id,pr,lines),/Every PO item/);assert.deepEqual(await totals(),before);assert.equal(await stock(),q);
      assert.equal(await scalar('select status from purchase_orders where id=$1',[id]),'Approved');
    });
    await t.test('expense insert failure also rolls back stock and receipt status',async()=>{
      await db.exec("create function qa_fail_expense() returns trigger language plpgsql as $$begin raise exception 'QA forced failure';end$$;create trigger zz_qa_fail_expense before insert on expenses for each row execute function qa_fail_expense()");
      const id=await order(),pr=await preview(id),before=await totals(),q=await stock();await assert.rejects(receive(id,pr),/QA forced/);
      assert.deepEqual(await totals(),before);assert.equal(await stock(),q);await db.exec('drop trigger zz_qa_fail_expense on expenses');
    });
    await t.test('every PO item needs a tracker destination; no expense-only skip',async()=>{
      const id=await order(),pr=await preview(id),q=await stock();
      await assert.rejects(receive(id,pr,[{item_id:pr.order.purchase_order_items[0].id,material_id:null,skip_reason:'Skip'}]),/Every PO item/);
      assert.equal(await stock(),q);
    });
    await t.test('explicit pack conversion increases stock by chosen qty, not PO qty, while preserving expense total',async()=>{
      const id=await order(),pr=await preview(id),q=await stock();await receive(id,pr,[{...choices(pr)[0],quantity:1}]);assert.equal(await stock(),q+1);
      const line=pr.order.purchase_order_items[0];assert.equal(await scalar('select quantity*unit_amount from expenses where purchase_order_item_id=$1',[line.id]),60);
    });
    await t.test('wrong branch material cannot be received; initialized book cost remains internally consistent',async()=>{
      const other=crypto.randomUUID();await db.query("insert into inventory_tracker_materials(id,business_id,branch_id,item_name,quantity) values($1,$2,$3,'Other branch',0)",[other,ids.business,ids.other]);
      const id=await order(),pr=await preview(id);await assert.rejects(receive(id,pr,[{...choices(pr)[0],material_id:other}]),/unavailable in this branch/);
      await db.query("update inventory_tracker_materials set cost_initialized=true,cost_value=100,measure_unit='pc' where id=$1",[ids.material]);
      await receive(id,pr);assert.equal(await scalar('select cost_value from inventory_tracker_materials where id=$1',[ids.material]),160);
    });
    await t.test('RLS prevents direct receipt insertion and read-only staff cannot call receive',async()=>{
      const id=await order(),pr=await preview(id);
      await db.exec('set role authenticated');
      await assert.rejects(db.query('insert into purchase_order_receipts(purchase_order_id) values($1)',[id]),/permission denied/);
      await db.query("select set_config('test.user',$1,false)",[ids.staff]);await assert.rejects(receive(id,pr),/edit access/);
      await db.exec('reset role');await db.query("select set_config('test.user',$1,false)",[ids.user]);
      await db.query('update branches set is_active=false where id=$1',[ids.branch]);await assert.rejects(receive(id,pr),/edit access/);
      await db.query('update branches set is_active=true where id=$1',[ids.branch]);
    });
  }finally{await db.close()}
});
