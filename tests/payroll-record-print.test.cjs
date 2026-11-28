const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const P=require('../payroll-v2/print-view.js'),root=path.resolve(__dirname,'..');
test('HTML print preserves half/full paper and escaped identity without loading a PDF engine',()=>{
 const r={snapshot:{employee:{name:'Test <script>alert(1)</script>'},period:{releaseDate:'2026-11-28'}}},before=structuredClone(r);
 for(const fullPages of [0,2]){
  const html=P.html(r,{html:'<section class="print-sheet">PAYROLL FIXTURE</section>',fullPages},'https://test.invalid/payroll-v2/index.html');
  assert.match(html,new RegExp('@page\\{size:8.5in '+(fullPages?'11in':'5.5in')));assert.match(html,/PAYROLL FIXTURE/);assert.match(html,/window.print\(\)/);
  assert.match(html,/Test &lt;script&gt;/);assert.doesNotMatch(html,/<script|pdfmake|PayrollPDF|fetch\(|supabase|payroll_v2_save/);assert.match(html,/href="https:\/\/test.invalid\/payroll-v2\/"/);
 }
 assert.deepEqual(r,before);assert.throws(()=>P.html(r,{html:'',fullPages:0},'file:///private/local.html'),/Open payroll/);
});
test('preview uses measured HTML only, and print module is versioned before the app',()=>{
 const app=fs.readFileSync(path.join(root,'payroll-v2/app-v2.js'),'utf8'),index=fs.readFileSync(path.join(root,'payroll-v2/index.html'),'utf8');
 const preview=app.slice(app.indexOf('async function showPreview'),app.indexOf('function simplePreview'));
 assert.doesNotMatch(preview,/PayrollPDF|\.layout\(/);assert.match(preview,/PayrollSlips.render\(printable\)/);assert.match(preview,/previewRecords=printable/);
 assert.ok(index.indexOf('print-view.js?v=20261128-payday-total')<index.indexOf('app-v2.js?v=20261128-record-print'));
 assert.match(index,/online.js\?v=20261128-record-print/);
});
