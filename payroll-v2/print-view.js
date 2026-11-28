/* Read-only HTML printing. No PDF rendering, server writes or receipt changes. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PayrollPrint=api;
})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function html(record,layout,baseUrl){
    const base=new URL('.',baseUrl);if(!['https:','http:'].includes(base.protocol))throw Error('Open payroll in BWC before printing.');
    const paper=layout.fullPages?'full':'half',height=paper==='full'?'11in':'5.5in';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${esc(base.href)}"><title>Payslip · ${esc(record.snapshot.employee.name)} · ${esc(record.snapshot.period.releaseDate)}</title><link rel="stylesheet" href="half-payslip.css?v=20261128-payday-total"><style>
      *{box-sizing:border-box}body{margin:0;background:#eef1f2;color:#182c36;font-family:Arial,sans-serif}.print-controls{padding:16px;position:sticky;top:0;background:white;border-bottom:1px solid #ccd2d6;z-index:1}.print-controls p{margin:8px 0 0;font-size:13px;line-height:1.5}.print-controls button{padding:12px 24px;background:#bd4511;border:0;border-radius:6px;color:white;font-size:16px;cursor:pointer}.print-controls small{margin-left:12px}.print-pages{overflow-x:auto;padding:16px}.print-sheet{display:block;width:8.5in;margin:0 auto 16px;background:white}.half-slip th{white-space:pre-line}.half-slip small{color:#333}
      @page{size:8.5in ${height};margin:0}@media print{body{background:white}.print-controls{display:none}.print-pages{padding:0;overflow:visible}.print-sheet{margin:0;break-after:page;page-break-after:always}.print-sheet:last-child{break-after:auto;page-break-after:auto}}
    </style></head><body><header class="print-controls"><button type="button" onclick="window.print()">Print</button><small>${paper==='half'?'Half short bond · 8.5 × 5.5 inches':'Full short bond / Letter · 8.5 × 11 inches'}</small><p>Read-only payslip. Printing does not save or confirm a payment. Use Actual size / 100%, margins None, and turn off browser headers and footers. You may also take a screenshot.</p></header><main class="print-pages">${layout.html}</main></body></html>`;
  }
  function write(win,record){
    if(!win)throw Error('Allow the payslip window to open, then click Print again.');
    const layout=window.PayrollSlips.render([record]);
    win.document.open();win.document.write(html(record,layout,document.baseURI));win.document.close();
  }
  return {html,write};
});
