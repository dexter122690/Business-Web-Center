/* Makes quotation drafts and quotations shared for the active business. */
(function(){
  var config=window.BUSINESS_WEB_CENTER_SUPABASE||{},db=null,resolvingBusiness=null;
  function quoteStorageKey(){return '15m-replica-quotes:'+(localStorage.getItem('bwc-active-business')||'pending-business')+':'+(localStorage.getItem('bwc-active-branch')||'pending-branch')}
  function read(){try{return JSON.parse(localStorage.getItem(quoteStorageKey())||'[]')}catch(e){return []}}
  function write(items){localStorage.setItem(quoteStorageKey(),JSON.stringify(items))}
  function ready(){if(db)return Promise.resolve(true);if(!window.supabase||!config.url||!config.publishableKey)return Promise.resolve(false);db=window.getBusinessSupabaseClient&&window.getBusinessSupabaseClient();return Promise.resolve(!!db)}
  function pause(ms){return new Promise(function(resolve){setTimeout(resolve,ms)})}
  async function resolveBusiness(user){
    var cached=localStorage.getItem('bwc-active-business');
    if(cached)return cached;
    if(resolvingBusiness)return resolvingBusiness;
    resolvingBusiness=(async function(){
      var memberships=await db.from('business_memberships').select('business_id,businesses!inner(id,name,status)').eq('user_id',user.id).eq('status','active');
      var rows=(memberships.data||[]).filter(function(row){return row.businesses&&row.businesses.status!=='suspended'});
      if(rows.length===1){localStorage.setItem('bwc-active-business',rows[0].business_id);localStorage.setItem('bwc-active-business-name',rows[0].businesses.name||'');return rows[0].business_id}
      var owned=await db.from('businesses').select('id,name').eq('created_by',user.id).order('created_at',{ascending:true}).limit(2);
      if(owned.data&&owned.data.length===1){localStorage.setItem('bwc-active-business',owned.data[0].id);localStorage.setItem('bwc-active-business-name',owned.data[0].name||'');return owned.data[0].id}
      return '';
    })();
    try{return await resolvingBusiness}finally{resolvingBusiness=null}
  }
  async function context(){
    /* A branch switch and the Supabase session may finish after the page is visible.
       Wait long enough to obtain both identifiers, never saving a quote to a blank branch. */
    for(var attempt=0;attempt<60;attempt++){
      if(await ready()){
        var session=await db.auth.getSession(),user=session.data&&session.data.session&&session.data.session.user;
        if(user){
          var businessId=await resolveBusiness(user),branchId=localStorage.getItem('bwc-active-branch');
          if(businessId&&branchId)return {user:user,businessId:businessId,branchId:branchId};
        }
      }
      await pause(250);
    }
    return null;
  }
  function mapQuote(q){var d=q.details||{},lines=(q.quotation_lines||[]).slice().sort(function(a,b){return a.sort_order-b.sort_order}).map(function(x){return {category:x.category,description:x.description,qty:Number(x.quantity),price:Number(x.unit_price)}});return {id:q.id,number:q.quotation_number,status:q.status,client:q.client_name,contact:q.contact_number,address:q.client_address,vehicle:q.vehicle,plate:q.plate_number,date:q.quotation_date,valid:q.valid_until||'',color:d.color||'',vin:d.vin||'',damage:d.damage||'',repair:d.repair||'',deposit:d.deposit||'',notes:d.notes||'',preparedBy:d.prepared_by||'',discountType:d.discount_type||'none',discountValue:Number(d.discount_value||0),discountAmount:Number(d.discount_amount||0),subtotal:Number(d.subtotal_amount||q.total_amount||0),lines:lines,total:Number(q.total_amount)}}
  async function hydrate(){var c=await context();if(!c)return;var query=db.from('quotations').select('*,quotation_lines(*)').eq('business_id',c.businessId).eq('branch_id',c.branchId);var result=await query.order('updated_at',{ascending:false});if(result.error)return;write((result.data||[]).map(mapQuote));document.dispatchEvent(new CustomEvent('bwc:quotations-hydrated',{detail:{businessId:c.businessId,branchId:c.branchId}}))}
  function currentSaved(){var client=(document.getElementById('qtClient')||{}).value||'',date=(document.getElementById('qtDate')||{}).value||'',vehicle=(document.getElementById('qtVehicle')||{}).value||'',plate=(document.getElementById('qtPlate')||{}).value||'',all=read();return all.find(function(q){return q.client===client&&q.date===date&&q.vehicle===vehicle&&q.plate===plate})||null}
  async function persist(exactQuote){var c=await context(),q=exactQuote||currentSaved();if(!c){alert('The shared workspace could not be reached. Check your connection, then try Save as PDF again.');return false}if(!q||!q.lines||!q.lines.length){alert('Add at least one quotation line before saving.');return false}if(!String(q.client||'').trim()){alert('Enter the customer or company name before saving.');return false}var payload={business_id:c.businessId,branch_id:c.branchId,quotation_number:q.number,status:q.status==='Draft'?'Draft':'Ready',client_name:q.client,contact_number:q.contact||'',client_address:q.address||'',vehicle:q.vehicle||'',plate_number:q.plate||'',quotation_date:q.date||new Date().toISOString().slice(0,10),valid_until:q.valid||null,total_amount:Number(q.total||0),details:{color:q.color||'',vin:q.vin||'',damage:q.damage||'',repair:q.repair||'',deposit:q.deposit||'',notes:q.notes||'',prepared_by:q.preparedBy||'',discount_type:q.discountType||'none',discount_value:Number(q.discountValue||0),discount_amount:Number(q.discountAmount||0),subtotal_amount:Number(q.subtotal||q.total||0)},created_by:c.user.id};var parent=await db.from('quotations').upsert(payload,{onConflict:'business_id,branch_id,quotation_number'}).select('id').single();if(parent.error){alert('The quotation could not be saved online. '+parent.error.message);return false}var removed=await db.from('quotation_lines').delete().eq('quotation_id',parent.data.id);if(removed.error){alert('The quotation could not update its line items.');return false}var rows=q.lines.map(function(line,index){return {quotation_id:parent.data.id,category:line.category||'Body & Tinsmith',description:line.description,quantity:Number(line.qty)||1,unit_price:Number(line.price)||0,sort_order:index}});var lines=await db.from('quotation_lines').insert(rows);if(lines.error){alert('The quotation header was saved, but its line items need retrying.');return false}var all=read(),index=all.findIndex(function(x){return x.number===q.number});if(index>=0){all[index].id=parent.data.id;write(all)}document.dispatchEvent(new CustomEvent('bwc:quotations-saved'));return true}
  window.saveQuotationOnline=persist;
  document.addEventListener('click',function(e){var button=e.target.closest('[data-qt="save-ready"]');if(!button)return;setTimeout(persist,100)},true);
  document.addEventListener('click',function(e){if(e.target.closest('[data-t="quotes"],[data-restore-tab="quotes"]'))setTimeout(hydrate,20)},true);
  document.addEventListener('bwc:branch-ready',function(){setTimeout(hydrate,40)});
  window.addEventListener('load',function(){setTimeout(hydrate,700)});
})();
