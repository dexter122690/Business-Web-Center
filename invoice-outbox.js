/* Durable, immutable invoice requests. One storage key per request prevents
   different tabs from overwriting each other's queue. Server receipts make
   retries (including a lost response) safe. Never infer a legacy row's branch. */
(function(root,factory){var api=factory(typeof module==='object'&&module.exports?require('./pms-rules.js'):root.BwcPmsRules);if(typeof module==='object'&&module.exports)module.exports=api;else root.BwcInvoiceOutbox=api})(typeof window!=='undefined'?window:this,function(PMS){
 'use strict';
 var PREFIX='bwc-invoice-outbox-v2:',LEGACY='15m-offline-invoice-queue';
 function clone(x){return JSON.parse(JSON.stringify(x))}
 function valid(record){
  var s=record&&record.scope,x=record&&record.invoice;
  if(!record||record.version!==2||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(record.requestId||'')||!s||!s.userId||!s.businessId||!s.branchId||!x||x.remoteId||x.isNewInvoice!==true||!Array.isArray(x.services)||!Array.isArray(x.parts))throw Error('This offline record needs owner review. Its original account or branch cannot be verified.');
  return record;
 }
 function create(storage){
  function list(){var rows=[],damaged=0;for(var i=0;i<storage.length;i++){var k=storage.key(i);if(k&&k.indexOf(PREFIX)===0){try{var r=valid(JSON.parse(storage.getItem(k)));if(k!==PREFIX+r.requestId)throw Error('Mismatched key');rows.push(r)}catch(e){damaged++}}}return {rows:rows,damaged:damaged}}
  function put(record){valid(record);var key=PREFIX+record.requestId,text=JSON.stringify(record),old=storage.getItem(key);if(old&&old!==text)throw Error('This upload reference already contains different information. Nothing was overwritten.');storage.setItem(key,text);if(storage.getItem(key)!==text)throw Error('Browser storage could not confirm this save. Keep the form open.');return clone(record)}
  function acknowledge(record,result){
   if(!result||result.request_id!==record.requestId||result.business_id!==record.scope.businessId||result.branch_id!==record.scope.branchId||result.created_by!==record.scope.userId||!result.invoice_id||!result.invoice_number)throw Error('The upload receipt did not match this invoice. The local copy was kept.');
   var key=PREFIX+record.requestId,stored=storage.getItem(key);if(stored&&stored!==JSON.stringify(record))throw Error('The local record changed. It was kept for review.');storage.removeItem(key);if(storage.getItem(key)!==null)throw Error('Uploaded, but the local receipt could not be cleared. Retrying is safe.');
  }
  function owned(scope){return list().rows.filter(function(r){return r.scope.userId===scope.userId&&r.scope.businessId===scope.businessId})}
  function legacyCount(){var raw=storage.getItem(LEGACY);if(!raw)return 0;try{var rows=JSON.parse(raw);return Array.isArray(rows)?rows.length:1}catch(e){return 1}}
  function backup(scope){return JSON.stringify({format:'BWC invoice recovery',version:2,exportedAt:new Date().toISOString(),records:owned(scope)},null,2)}
  function restore(text,scope){var data=JSON.parse(text);if(data.format!=='BWC invoice recovery'||data.version!==2||!Array.isArray(data.records))throw Error('Choose a BWC invoice recovery backup.');data.records.forEach(function(r){valid(r);if(r.scope.userId!==scope.userId||r.scope.businessId!==scope.businessId)throw Error('Sign in to the original account and business to restore this backup.');var old=storage.getItem(PREFIX+r.requestId);if(old&&old!==JSON.stringify(r))throw Error('A recovery record conflicts with an existing request. Nothing was overwritten.')});data.records.forEach(put);return data.records.length}
  return {list:list,put:put,acknowledge:acknowledge,owned:owned,legacyCount:legacyCount,backup:backup,restore:restore};
 }
 function request(scope,invoice,crypto){
  if(!crypto||typeof crypto.randomUUID!=='function')throw Error('Secure offline saving is unavailable in this browser. Use the HTTPS BWC page.');
  var id=crypto.randomUUID(),x=clone(invoice);
  if(!PMS)throw Error('PMS invoice safeguards are not ready. Reload BWC while online.');
  if(PMS.hasPms(x.services)){x.pms=PMS.details(x.pms);x.pms.next_pms_date=PMS.schedule(x.total,[{date:x.paymentDate,amount:x.paid}])||null}
  x.id='offline:'+id;x.number='OFF-'+id.slice(0,13).toUpperCase();x.offlinePending=true;
  return valid({version:2,requestId:id,createdAt:new Date().toISOString(),scope:clone(scope),invoice:x});
 }
 function args(record){valid(record);var x=record.invoice,s=record.scope;return {p_business_id:s.businessId,p_branch_id:s.branchId,p_request_id:record.requestId,p_payload:{client_name:x.client,contact_number:x.contact,client_address:x.address,client_email:x.email||null,vehicle_make:x.make,vehicle_year_model:x.yearModel,vehicle_color:x.color,plate_number:x.plate,invoice_date:x.date,release_date:x.release||null,assigned_admin:x.admin,payment_method:x.method,client_source:x.source,discount_amount:x.discount||0},p_services:x.services.map(function(v){return {service_name:v.n,service_detail:v.d||null,amount:Number(v.a)}}),p_parts:x.parts.map(function(v){return {part_name:v.n,quantity:Number(v.q),unit_price:Number(v.p)}}),p_payment:{amount:Number(x.paid||0),date:x.paymentDate||null},p_pms:x.pms||{}}}
 return {create:create,request:request,args:args,valid:valid,PREFIX:PREFIX};
});
