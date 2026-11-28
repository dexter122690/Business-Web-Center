// Synthetic, offline-only benchmark. No BWC connection, real records or writes.
// Run: node tests/benchmarks/payroll-pdf-save.cjs
const {performance}=require('node:perf_hooks');
const W=require('../../payroll-v2/workflow.js'),S=require('../../payroll-v2/simple-painter.js'),PDF=require('../../payroll-v2/pdf.js');
const engine=require('../../payroll-v2/vendor/pdfmake.min.js');engine.vfs=require('../../payroll-v2/vendor/vfs_fonts.js');
let id=0;
const seed=W.emptyWorkspace([{id:'benchmark',name:'Synthetic Benchmark Painter',position:'Painter',type:'contract',rate:0}],undefined,'2026-11-21');
function record(count,long){
 return S.savedFor(S.save(seed,'benchmark',Array.from({length:count},(_,i)=>({unit:'Synthetic unit '+i,invoice:'TEST-'+i,plate:'TEST '+i,color:'Silver',contract:10000,weekly:1000,work:long?'Repair, prepare and repaint the front and rear panels. '.repeat(8):'Panel repaint'})),500,()=>`benchmark-${++id}`),'benchmark');
}
async function old(record,minimumPaper){const result=await PDF.layout(record,{engine,minimumPaper});return new Promise(resolve=>engine.createPdf(result.definition).getDataUrl(resolve))}
const median=xs=>xs.sort((a,b)=>a-b)[Math.floor(xs.length/2)];
(async()=>{
 for(const [label,r,paper] of [['short half-bond',record(1,false),'half'],['14-unit full-bond',record(14,false),'full'],['long multi-page',record(25,true),'full']]){
  const optimized=()=>PDF.dataUrl(r,{engine,minimumPaper:paper}),baseline=()=>old(r,paper),times={before:[],after:[]};
  await baseline();await optimized();
  for(let n=0;n<7;n++)for(const name of n%2?['after','before']:['before','after']){const start=performance.now();await (name==='before'?baseline():optimized());times[name].push(performance.now()-start)}
  const before=median(times.before),after=median(times.after);
  console.log(JSON.stringify({case:label,beforeMs:Math.round(before),afterMs:Math.round(after),reductionPercent:Math.round((1-after/before)*100)}));
 }
})().catch(error=>{console.error(error);process.exitCode=1});
