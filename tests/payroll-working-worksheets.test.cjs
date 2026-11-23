const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),A=require('../payroll-v2/payslip-archive.js');
const seed=()=>W.emptyWorkspace([{id:'p',name:'Test painter',position:'Painter',type:'contract',rate:0},{id:'p2',name:'Other painter',position:'Painter',type:'contract',rate:0}],undefined,'2026-11-14');
const copy=structuredClone;let id=0;const uid=()=>`working-test-${++id}`;
test('changed and unchanged saves reuse one worksheet; other employees and weeks stay intact',()=>{
 let s=S.save(seed(),'p',[{unit:'Test unit',contract:15000,weekly:3000,work:'Test job'}],500,uid),first=copy(s.painterTestSheets[0]);
 for(const weekly of [3200,3500,3500])s=S.save(s,'p',[{id:first.snapshot.rows[0].job.id,weekly}],500,uid);
 assert.equal(s.painterTestSheets.length,1);assert.equal(s.painterTestSheets[0].id,first.id);assert.equal(s.painterTestSheets[0].snapshot.net,3000);
 s=S.save(s,'p2',[{unit:'Other unit',contract:1000,weekly:200}],0,uid);const other=copy(S.savedFor(s,'p2')),previous=copy(S.savedFor(s,'p'));
 s=W.selectWeek(s,'2026-11-21');assert.equal(S.view(s,'p').snapshot.rows[0].opening,11500);
 s=S.save(s,'p',[{id:first.snapshot.rows[0].job.id,weekly:5000}],0,uid);
 assert.equal(s.painterTestSheets.length,3);assert.deepEqual(s.painterTestSheets.find(x=>x.id===other.id),other);assert.deepEqual(s.painterTestSheets.find(x=>x.id===previous.id),previous);
 assert.equal(S.savedFor(s,'p').snapshot.rows[0].remaining,6500);
 assert.deepEqual(A.previousPayments(s,S.savedFor(s,'p').snapshot).map(x=>x.amount),[3500]);
});
test('cleanup keeps the last ordinal per week, released sources, all other data and calculation order',()=>{
 let s=S.save(seed(),'p',[{unit:'First description',contract:15000,weekly:3000}],500,uid),old=copy(s.painterTestSheets[0]);
 s=W.selectWeek(s,'2026-11-21');s=S.save(s,'p',[{id:old.snapshot.rows[0].job.id,unit:'Latest week description',weekly:2000}],0,uid);
 const revised=copy(old);revised.id=uid();revised.snapshot.rows[0].job.unit='Earlier week revision';s.painterTestSheets.push(revised);
 const current=copy(S.view(s,'p')),jobs=copy(S.jobs(s,'p')),before=copy(s),clean=S.compact(s);
 assert.equal(clean.painterTestSheets.length,2);assert.deepEqual(S.view(clean,'p'),current);assert.deepEqual(S.jobs(clean,'p'),jobs);
 const nonSheets=x=>{const n=copy(x);delete n.painterTestSheets;return n};assert.deepEqual(nonSheets(clean),nonSheets(s));assert.deepEqual(s,before);
 s=W.selectWeek(s,'2026-11-28');assert.deepEqual(S.view(S.compact(s),'p'),S.view(s,'p'));
 const backed=copy(s);backed.releasedPainterSlips=[{sourceId:old.id}];assert.ok(S.compact(backed).painterTestSheets.some(x=>x.id===old.id));
 assert.deepEqual(S.compact(clean),clean);assert.deepEqual(S.validate(clean,before),[]);
 const rollback=copy(before);rollback.painterTestSheets=rollback.painterTestSheets.filter(x=>x.id!==revised.id);assert.match(S.validate(rollback,before).join(),/latest working/);
});
test('released copies and source are immutable; explicit empty only replaces this working week',()=>{
 let s=S.save(seed(),'p',[{unit:'Test unit',contract:10000,weekly:2000}],500,uid),record=S.savedFor(s,'p');
 const empty=S.emptyTable(s,'p',uid);assert.equal(empty.painterTestSheets.length,1);assert.equal(empty.painterTestSheets[0].id,record.id);assert.equal(empty.painterTestSheets[0].snapshot.rows.length,0);
 s=A.release(s,record.id,uid(),'2026-11-21');const frozen=copy(s.releasedPainterSlips[0]);
 assert.throws(()=>S.save(s,'p',[],0,uid),/released payslip/);assert.throws(()=>S.emptyTable(s,'p',uid),/released payslip/);
 const bad=copy(s);bad.painterTestSheets[0].savedAt='2026-11-23T00:00:00Z';assert.match(S.validate(bad,s).join(),/locked|preserved/);
 assert.deepEqual(S.compact(s).releasedPainterSlips[0],frozen);
});
test('worksheet renders without saved-copy list; current saved sheet remains printable',()=>{
 const s=S.save(seed(),'p',[{unit:'Test unit',contract:10000,weekly:2000}],0,uid);
 const html=S.render({state:s,esc:String,peso:String,range:p=>p.start+' to '+p.end,button:(label,action,attrs='')=>`<button data-action="${action}" ${attrs}>${label}</button>`},'p');
 assert.doesNotMatch(html,/Saved worksheet copies|simple-history-open|painter-histories/);
 assert.match(html,/Save table updates this employee/);assert.match(html,/id="painterPrint"/);assert.match(html,/id="painterRelease"/);
});
