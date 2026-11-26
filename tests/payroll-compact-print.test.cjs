const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),PDF=require('../payroll-v2/pdf.js');
const engine=require('../payroll-v2/vendor/pdfmake.min.js');
engine.vfs=require('../payroll-v2/vendor/vfs_fonts.js');
let serial=0;const uid=()=>`compact-${++serial}`;
function record(count=1,long=false){
 const state=S.save(W.emptyWorkspace([{id:'p',name:'Print Test Painter',type:'contract',position:'Auto painter',rate:0}],undefined,'2026-11-21'),'p',Array.from({length:count},(_,i)=>({unit:`Unit ${i+1}`,plate:`PRINT ${i+1}`,invoice:`INV-${i+1}`,color:'Blue',contract:10000,weekly:1000,work:long?'Repair front bumper, repaint rear bumper and polish the completed panels. '.repeat(8):'Panel repaint'})),500,uid);
 return S.savedFor(state,'p');
}
function html(){const window={SimplePainter:S,PayrollWorkflow:W};vm.runInNewContext(fs.readFileSync(require.resolve('../payroll-v2/half-slips.js'),'utf8'),{window});return window.PayrollSlips}
test('compact print omits historical breakdowns without deleting snapshot history',()=>{
 const r=record();r.snapshot.previousPayments=[{jobId:r.snapshot.rows[0].job.id,amount:1234,date:'2026-11-14',note:'Earlier payment'}];r.snapshot.rows[0].job.priorSettlement=1234;
 const before=structuredClone(r),pdf=JSON.stringify(PDF.definition(r)),preview=html().bodyHtml(html().blocks(r.snapshot,true));
 for(const value of [pdf,preview]){assert.doesNotMatch(value,/PREV\. RECORDED|Previous recorded|PREVIOUS PAYMENT|PREVIOUS ENTRIES|PRE-BWC SETTLEMENTS|Earlier payment/);assert.match(value,/BALANCE BEFORE|Balance before/);assert.match(value,/₱1,000.00/)}
 assert.equal(PDF.definition(r).content[2].table.body[0].length,7);assert.deepEqual(r,before);
});
test('measured PDF keeps a short payslip half-bond',async()=>{
 const r=record(),before=structuredClone(r),layout=await PDF.layout(r,{engine});
 assert.equal(layout.paper,'half');assert.equal(layout.pages,1);assert.deepEqual(layout.definition.pageSize,{width:612,height:396});assert.equal(layout.definition.defaultStyle.fontSize,7.5);assert.deepEqual(r,before);
});
test('measured PDF expands a longer payslip to one full-bond page without shrinking',async()=>{
 const r=record(14),layout=await PDF.layout(r,{engine});
 assert.equal(layout.paper,'full');assert.equal(layout.pages,1);assert.deepEqual(layout.definition.pageSize,{width:612,height:792});assert.equal(layout.definition.defaultStyle.fontSize,7.5);
 for(const row of r.snapshot.rows)assert.ok(JSON.stringify(layout.definition).includes(row.job.unit));
});
test('very long wrapped job orders continue on full-bond pages with all rows and totals',async()=>{
 const r=record(25,true),before=structuredClone(r),layout=await PDF.layout(r,{engine});
 assert.equal(layout.paper,'full');assert.ok(layout.pages>1);assert.equal(layout.definition.content[2].table.body.length,26);assert.deepEqual(r,before);
 const json=JSON.stringify(layout.definition);assert.match(json,/₱24,500.00/);assert.match(json,/Prepared by/);assert.match(json,/Received by/);
});
test('screen-required full size is honored even for a shorter PDF layout',async()=>{
 const layout=await PDF.layout(record(),{engine,minimumPaper:'full'});assert.equal(layout.paper,'full');assert.equal(layout.pages,1);
 const card=html().cardHtml(record(),[],1,1,true,'full');assert.match(card,/half-slip full-slip/);
});
