/* Lets the quotation author choose an active administrator as Prepared by. */
(function () {
  var priorDecorator, priorPrint;
  function esc(value) { return String(value || '').replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function quoteStorageKey() { return '15m-replica-quotes:' + (localStorage.getItem('bwc-active-business') || 'pending-business') + ':' + (localStorage.getItem('bwc-active-branch') || 'pending-branch'); }
  function read() { try { return JSON.parse(localStorage.getItem(quoteStorageKey()) || '[]'); } catch (e) { return []; } }
  function selectedQuote() { var client=(document.getElementById('qtClient')||{}).value||'', date=(document.getElementById('qtDate')||{}).value||'', vehicle=(document.getElementById('qtVehicle')||{}).value||'', plate=(document.getElementById('qtPlate')||{}).value||''; return read().find(function(q){ return q.client===client&&q.date===date&&q.vehicle===vehicle&&q.plate===plate; }) || null; }
  function mount() {
    var deposit=document.getElementById('qtDeposit'); if (!deposit || document.getElementById('qtPreparedBy')) return;
    var label=document.createElement('label'); label.innerHTML='Prepared by<select id="qtPreparedBy"><option value="">Select admin</option></select>';
    deposit.closest('label').insertAdjacentElement('afterend',label);
    var quote=selectedQuote(), select=document.getElementById('qtPreparedBy'); if (quote && quote.preparedBy) select.dataset.savedValue=quote.preparedBy;
    loadAdmins();
  }
  async function loadAdmins() {
    var select=document.getElementById('qtPreparedBy'), db=window.getBusinessSupabaseClient&&window.getBusinessSupabaseClient(), business=localStorage.getItem('bwc-active-business');
    if (!select || !db || !business) return;
    select.disabled=true; select.options[0].textContent='Loading admins...';
    var result=await db.from('business_team_invites').select('full_name,role,status').eq('business_id',business).eq('role','admin').in('status',['accepted','approved']).order('full_name');
    if (result.error) { select.options[0].textContent='Select admin'; select.disabled=false; return; }
    var names=(result.data||[]).map(function(row){return String(row.full_name||'').trim();}).filter(Boolean).filter(function(name,index,list){return list.indexOf(name)===index;});
    select.innerHTML='<option value="">Select admin</option>'+names.map(function(name){return '<option value="'+esc(name)+'">'+esc(name)+'</option>';}).join('');
    var saved=select.dataset.savedValue||''; if (saved) { var option=Array.prototype.slice.call(select.options).find(function(item){return item.value===saved;}); if (!option) select.insertAdjacentHTML('beforeend','<option value="'+esc(saved)+'">'+esc(saved)+'</option>'); select.value=saved; }
    select.disabled=false;
  }
  function restorePreparedBy(id) {
    var quote=read().find(function(item){return item.id===id;}); if (!quote) return;
    mount(); var select=document.getElementById('qtPreparedBy'); if (!select) return;
    select.dataset.savedValue=quote.preparedBy||''; loadAdmins();
  }
  function install() {
    priorDecorator=window.BWCQuotationDiscount;
    window.BWCQuotationDiscount=function(quote,subtotal) { quote=priorDecorator?priorDecorator(quote,subtotal):quote; quote.preparedBy=(document.getElementById('qtPreparedBy')||{}).value||''; return quote; };
    document.addEventListener('click',function(event){ var edit=event.target.closest('[data-qt-edit]'); if(edit)setTimeout(function(){restorePreparedBy(edit.dataset.qtEdit);},90); if(event.target.closest('[data-t="quotes"],[data-qt="new"]'))setTimeout(mount,90); },true);
    priorPrint=window.printQuotation;
    if (priorPrint) window.printQuotation=function(mode) { var prepared=(document.getElementById('qtPreparedBy')||{}).value||'', popup=priorPrint.call(this,mode); if(popup&&prepared){var terms=popup.document.querySelector('h3:last-of-type');var block='<div style="margin-top:42px;text-align:center;max-width:260px"><div style="border-top:1px solid #16100d;padding-top:6px;font-weight:bold">'+esc(prepared)+'</div><small>Prepared by</small></div>';if(terms)terms.insertAdjacentHTML('afterend',block);else popup.document.body.insertAdjacentHTML('beforeend',block);} return popup; };
    mount();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(install,100);});else setTimeout(install,100);
}());
