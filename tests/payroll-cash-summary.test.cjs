const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),A=require('../payroll-v2/payslip-archive.js'),R=require('../payroll-v2/retained-payday.js'),M=require('../payroll-v2/cash-summary.js');
let n=0;const uid=()=>`cash-${++n}`;
function seed(){
 let s=W.emptyWorkspace([{id:'p',name:'Painter',position:'Auto painter',type:'contract',rate:0},{id:'d',name:'Admin',position:'Staff',type:'daily',rate:600}],undefined,'2026-11-21');
 s=S.save(s,'p',[{unit:'Test unit',agreementMode:true,agreedWorkItems:[{description:'Repair',amount:10000}],weekly:4000}],500,uid);
 s.attendance=W.dates(s.period.start,s.period.end).map((date,i)=>({employeeId:'d',date,status:i===6?'rest':i===0?'late':'present',lateMinutes:i===0?60:0}));
 s.advances.push({id:uid(),employeeId:'d',date:'2026-11-23',amount:200});return s;
}
function retained(){
 let s=S.save(W.selectWeek(seed(),'2026-11-14'),'p',[{unit:'Retained car',contract:10000,weekly:5000,retentionStatus:'retained',unitReleasedOn:'2026-10-01'}],0,uid);
 s=S.save(W.selectWeek(s,'2026-11-21'),'p',[],500,uid);return s;
}
const summary=s=>M.calculate(s,'2026-11-21');
test('current payday uses the upcoming Saturday, including today on Saturday and year boundaries',()=>{
 for(const [day,start,payday] of [['2026-11-27','2026-11-21','2026-11-28'],['2026-11-28','2026-11-21','2026-11-28'],['2026-11-29','2026-11-28','2026-12-05'],['2027-01-02','2026-12-26','2027-01-02']])assert.deepEqual(M.currentPeriod(day),{start,end:W.addDays(start,6),releaseDate:payday});
 assert.match(fs.readFileSync(require.resolve('../payroll-v2/cash-summary.js'),'utf8'),/currentPeriod\(today=S.manilaDay\(\)\)/);
});
test('combines both teams net pay, not agreed labor or remaining unit balances, without changing data',()=>{
 const s=seed(),before=structuredClone(s),m=summary(s);
 assert.equal(m.rows.find(r=>r.id==='p').weeklyNet,3500);assert.equal(m.rows.find(r=>r.id==='d').weeklyNet,3325);
 assert.equal(m.totalPayroll,6825);assert.equal(m.cashToPrepare,6825);assert.equal(m.recorded,0);assert.equal(m.incomplete,0);assert.deepEqual(s,before);
});
test('latest worksheet counts once; earlier/future cutoffs and another employee never leak into totals',()=>{
 let s=seed(),job=S.savedFor(s,'p').snapshot.rows[0].job.id;s=S.save(s,'p',[{id:job,agreementMode:true,weekly:4500}],500,uid);
 s=S.save(W.selectWeek(s,'2026-11-28'),'p',[{id:job,agreementMode:true,weekly:1000}],0,uid);
 assert.equal(summary(s).totalPayroll,7325);assert.equal(M.calculate(s,'2026-11-28').totalPayroll,1000);
 assert.equal(M.calculate(s,'2026-11-07').totalPayroll,0);
});
test('released salary stays in total payroll but is excluded from cash still to prepare',()=>{
 let s=seed();s=A.release(s,S.savedFor(s,'p').id,uid(),'2026-11-28');
 const m=summary(s);assert.equal(m.totalPayroll,6825);assert.equal(m.releasedWeekly,3500);assert.equal(m.cashToPrepare,3325);
});
test('daily saved copies remain authoritative even if current rate changes; release counted once',()=>{
 let s=seed();s=W.savePayslip(s,'d',uid(),'2026-11-28T01:00:00Z');const slip=s.payslips[0];
 s.employees.find(e=>e.id==='d').rate=999;s.slipReleases.push({slipId:slip.id,date:'2026-11-28',confirmedAt:'2026-11-28T01:00:00Z'});
 const m=summary(s);assert.equal(m.rows.find(r=>r.id==='d').weeklyNet,3325);assert.equal(m.cashToPrepare,3500);assert.equal(m.recorded,3325);
});
test('due retention can be included for planning but never becomes a payment or bypasses 45 days',()=>{
 const s=retained(),before=structuredClone(s),m=M.calculate(s,'2026-11-21',{includeDue:false}),included=summary(s);
 assert.equal(m.dueRetained,5000);assert.equal(included.cashToPrepare,m.cashToPrepare+5000);assert.equal(included.totalPayroll,m.totalPayroll+5000);
 assert.equal(M.calculate(s,'2026-11-07',{includeDue:true}).dueRetained,0);assert.deepEqual(s,before);
});
test('recorded retained payment is counted once even with multiple combined PDF versions',()=>{
 let s=retained(),j=S.jobs(s,'p').find(j=>j.unit==='Retained car'),basis=S.receiptBasis(s,'p',j.id);
 s=R.receive(s,{employeeId:'p',jobId:j.id,date:'2026-11-26',expectedAmount:basis.amount,expectedReleaseDate:basis.unitReleasedOn,expectedPeriod:R.target(s,'p','2026-11-26').period,acknowledge:true},uid,'2026-11-26T01:00:00Z','2026-11-26');
 const beforeRelease=summary(s);assert.equal(beforeRelease.receivedRetained,5000);assert.equal(beforeRelease.dueRetained,0);
 s=R.refresh(A.release(s,S.savedFor(s,'p').id,uid(),'2026-11-28'),uid,'2026-11-28T01:00:00Z');
 assert.equal(s.retainedPaydayCopies.length,2);const m=summary(s);
 assert.equal(m.totalPayroll,beforeRelease.totalPayroll);assert.equal(m.receivedRetained,5000);assert.equal(m.cashToPrepare,3325);
 assert.equal(M.calculate(s,'2026-11-28',{includeDue:true}).receivedRetained,0);assert.equal(M.calculate(s,'2026-11-28',{includeDue:true}).dueRetained,0);
});
test('negative net pay never cancels another employee cash requirement, and missing attendance warns',()=>{
 const s=seed();s.attendance=[];s.advances[0].amount=900;
 const m=summary(s);assert.equal(m.rows.find(r=>r.id==='d').weeklyNet,-900);assert.equal(m.cashToPrepare,3500);
 assert.match(m.rows.find(r=>r.id==='d').warnings.join(' '),/Attendance is incomplete.*Deductions exceed/);assert.equal(m.incomplete,1);
});
test('empty payroll is visibly incomplete, not an invented full-week salary',()=>{
 const s=W.emptyWorkspace(seed().employees,undefined,'2026-11-21'),m=summary(s);
 assert.equal(m.cashToPrepare,0);assert.equal(m.incomplete,2);assert.equal(m.totalPayroll,0);
});
test('saved per-employee payday is respected and former employees with amounts are not lost',()=>{
 let s=seed();s=S.save(W.setPayday(s,'2026-11-27'),'p',[],500,uid);s.employees[0].archived=true;
 const m=summary(s);assert.equal(m.rows.find(r=>r.id==='p').payday,'2026-11-27');assert.equal(m.rows.find(r=>r.id==='p').weeklyNet,3500);
 assert.equal(M.calculate(s,'2026-12-05').rows.some(r=>r.id==='p'),false);
});
test('unknown retained agreement is flagged instead of inventing cash; separate branch states stay separate',()=>{
 let s=S.save(W.emptyWorkspace(seed().employees,undefined,'2026-11-21'),'p',[{unit:'Unpriced retained',contract:'',weekly:100,retentionStatus:'retained',unitReleasedOn:'2026-10-01'}],0,uid);
 const m=M.calculate(s,'2026-11-21',{includeDue:true});assert.equal(m.dueRetained,0);assert.equal(m.cashToPrepare,100);assert.match(m.rows[0].warnings.join(),/balance needs review/);
 const other=W.emptyWorkspace([],undefined,'2026-11-21');assert.equal(summary(other).totalPayroll,0);
});
test('home summary appears ahead of employees, escapes names, and keeps controls read-only',()=>{
 const s=seed();s.employees[0].name='<script>bad()</script>';
 const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 const x={state:s,ui:{cashWeek:'2026-11-21'},C:W,esc,peso:n=>'PHP '+n,dateText:String,range:p=>p.start+' to '+p.end,button:()=>'',initials:()=>''};
 const context={window:{PayrollCashSummary:M,SimplePainter:S}};vm.runInNewContext(fs.readFileSync(require.resolve('../payroll-v2/board.js'),'utf8'),context);
 const html=context.window.PayrollBoard.home(x);assert.ok(html.indexOf('Cash to prepare')<html.indexOf('<h1>Employees'));
 assert.match(html,/2026-11-21 to 2026-11-27/);assert.match(html,/PHP 6825/);assert.doesNotMatch(html,/<script>bad/);assert.match(html,/cashSummaryWeek/);
 const code=fs.readFileSync(require.resolve('../payroll-v2/app-v2.js'),'utf8');assert.match(code,/if\(ui.view==='home'\)state=C.selectWeek\(state,ui.cashWeek/);
 const online=fs.readFileSync(require.resolve('../payroll-v2/online.js'),'utf8');assert.match(online,/'painterWeek','cashSummaryWeek','cashIncludeDue'/);
 const index=fs.readFileSync(require.resolve('../payroll-v2/index.html'),'utf8');assert.ok(index.indexOf('cash-summary.js')<index.indexOf('board.js'));
});
