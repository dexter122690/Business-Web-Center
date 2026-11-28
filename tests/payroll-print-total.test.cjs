const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),PDF=require('../payroll-v2/pdf.js');
const window={SimplePainter:S,PayrollWorkflow:W};
vm.runInNewContext(fs.readFileSync(require.resolve('../payroll-v2/half-slips.js'),'utf8'),{window});
const H=window.PayrollSlips;
function record(){let n=0;return S.savedFor(S.save(W.emptyWorkspace([{id:'p',name:'Print Test',position:'Painter',type:'contract',rate:0}],undefined,'2026-11-21'),'p',[{unit:'TEST',plate:'TEST 1',contract:10000,weekly:1000,work:'Repair'}],200,()=>`total-${++n}`),'p')}

test('every HTML print part shows one whole-payslip net total, excluding unpaid balances and historical receipts',()=>{
 const r=record();r.snapshot.retentionReceipts=[{amount:99999}];r.snapshot.retainedPaydayTotal=99999;
 const before=structuredClone(r);
 for(const [part,last] of [[1,false],[2,true]]){
  const html=H.cardHtml(r,H.blocks(r.snapshot),part,2,last,'full');
  const summary=html.match(/<div class="slip-payday-summary">([\s\S]*?)<\/small><\/div>/)[1];
  assert.match(summary,/TOTAL PAY FOR THIS PAYDAY/);assert.match(summary,/₱800.00/);
  assert.doesNotMatch(summary,/₱9,000.00|₱99,999.00|₱100,799.00/);
  assert.match(summary,/Whole-payslip total, not per page/);assert.match(summary,/Outstanding balances excluded/);
  if(!last)assert.match(html,/Full breakdown and signatures appear on the final part only/);
 }
 assert.deepEqual(r,before);
 const d=PDF.definition(r);assert.match(JSON.stringify(d.content[1]),/TOTAL PAY FOR THIS PAYDAY: ₱800.00/);
 assert.match(d.footer(2,2).text,/Total pay \(whole payslip\): ₱800.00/);
});

test('combined print clearly adds this payday retained payment exactly once without changing saved amounts',()=>{
 const r=record();Object.assign(r,{retainedPaydayCopy:true,version:2,updatedCopy:true,weeklyReleased:false});
 Object.assign(r.snapshot,{retainedPaydayPayments:[{basis:{unit:'TEST RETAINED',plate:'TEST R'},receivedOn:'2026-11-28',amount:850}],retainedPaydayTotal:850,paydayTotal:1650});
 const before=structuredClone(r),html=H.cardHtml(r,H.blocks(r.snapshot),1,1,true),d=PDF.definition(r);
 assert.match(html,/TOTAL PAY FOR THIS PAYDAY<\/strong><strong>₱1,650.00/);
 assert.match(html,/Net weekly salary ₱800.00 \+ retained payment ₱850.00/);
 assert.match(html,/Weekly salary not yet confirmed as received/);
 assert.match(JSON.stringify(d.content[1]),/TOTAL PAY FOR THIS PAYDAY: ₱1,650.00/);
 assert.match(d.footer(1,1).text,/₱1,650.00/);assert.doesNotMatch(d.footer(1,1).text,/₱2,500.00/);
 assert.deepEqual(r,before);
});

test('daily-rate print total is net after deductions, including legitimate zero and negative totals',()=>{
 for(const net of [800,0,-50]){
  const r={snapshot:{employee:{name:'Daily Test',position:'Staff',type:'daily',rate:550},period:{start:'2026-11-21',end:'2026-11-27',releaseDate:'2026-11-28'},rules:{hoursPerDay:8},paidDays:2,attendance:[],advances:[],basic:1100,late:100,cashAdvance:1000-net,net}};
  const expected='₱'+net.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  assert.ok(H.cardHtml(r,[],1,1,true).includes('TOTAL PAY FOR THIS PAYDAY</strong><strong>'+expected));
  assert.ok(JSON.stringify(PDF.definition(r).content[1]).includes('TOTAL PAY FOR THIS PAYDAY: '+expected));
 }
});

test('print summary assets are cache-versioned for the app and separate print window',()=>{
 const index=fs.readFileSync(require.resolve('../payroll-v2/index.html'),'utf8'),print=fs.readFileSync(require.resolve('../payroll-v2/print-view.js'),'utf8');
 for(const file of ['half-payslip.css','half-slips.js','pdf.js','print-view.js'])assert.ok(index.includes(file+'?v=20261128-payday-total'));
 assert.ok(print.includes('half-payslip.css?v=20261128-payday-total'));
});
