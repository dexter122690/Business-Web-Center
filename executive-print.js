/* Print-only presentation of the shared Executive Excel report.
   No database mutations, extra totals, truncation, or top-N row limits. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.BWCExecutivePrint = api; api.install(); }
}(typeof window !== 'undefined' ? window : null, function (root) {
  'use strict';
  var activeDialog = null, requestId = 0;
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c];
    });
  }
  function money(value) {
    if (!Number.isFinite(Number(value))) throw new Error('A report amount is invalid. Printing was stopped.');
    return 'PHP ' + Number(value).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2});
  }
  function table(section, label, rows, emptyLabel, totals) {
    var detail = rows.length ? rows : [[emptyLabel, 0]];
    return '<table class="statement"><colgroup><col class="description-col"><col class="amount-col"></colgroup><thead>' +
      '<tr><th colspan="2" class="section-title">' + esc(section) + '</th></tr>' +
      '<tr class="column-head"><th scope="col">' + esc(label) + '</th><th scope="col" class="amount">Amount (PHP)</th></tr></thead><tbody>' +
      detail.map(function (line) {
        return '<tr class="detail-row"><td class="description">' + esc(line[0]) + '</td><td class="amount">' + money(line[1]) + '</td></tr>';
      }).join('') + totals.map(function (line) {
        return '<tr class="' + line[2] + (Number(line[1]) < 0 ? ' negative' : '') + '"><th scope="row">' + esc(line[0]) + '</th><td class="amount">' + money(line[1]) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  function html(report, paper) {
    paper = paper === 'letter' ? 'letter' : 'a4';
    var name = report.businessName || report.brand.name, width = paper === 'letter' ? '215.9mm' : '210mm';
    var title = name + ' - Financial Report - ' + report.period;
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">' +
      '<title>' + esc(title) + '</title><style>' +
      '*{box-sizing:border-box}html{font:14px/1.45 Arial,Helvetica,sans-serif;color:#192735;background:#e8edf1}' +
      'body{margin:0;padding:22px 12px}.report{width:' + width + ';max-width:100%;margin:0 auto;padding:14mm;background:#fff;box-shadow:0 3px 18px #12223518}' +
      '.report-header{border-bottom:3px solid #b94116;padding-bottom:18px;margin-bottom:18px;break-inside:avoid}' +
      '.brand{font-size:23px;font-weight:700;letter-spacing:-.5px;overflow-wrap:anywhere}.report-title{font-size:13px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#a23a12;margin:7px 0 18px}' +
      '.metadata{display:grid;grid-template-columns:1fr 1fr;gap:12px 24px;font-size:14px}.metadata div{min-width:0;overflow-wrap:anywhere}.metadata span{display:block;font-size:12px;color:#536574;margin-bottom:3px}.metadata b{font-weight:600}' +
      '.statement{width:100%;border-collapse:collapse;table-layout:fixed;margin:22px 0 0}.description-col{width:68%}.amount-col{width:32%}' +
      'thead{display:table-header-group}tbody{vertical-align:top}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #dbe2e8;font-size:14px;line-height:1.45}' +
      '.section-title{font-size:15px;font-weight:700;color:#192735;border-bottom:2px solid #b94116;padding:10px 0 8px;letter-spacing:.7px}' +
      '.column-head th{background:#f0f3f6;color:#455665;font-size:12px;font-weight:600;padding-top:8px;padding-bottom:8px}' +
      '.description{white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal}.amount{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}' +
      'tr{break-inside:avoid;page-break-inside:avoid}.total th,.total td{font-weight:700;background:#f1f4f7;border-top:1px solid #9eacb8}' +
      '.profit th,.profit td{font-weight:700;border-top:1px solid #aab9b0;color:#204b35;background:#f0f7f2}' +
      '.net th,.net td{font-size:16px;font-weight:700;background:#e4eee8;border-top:2px solid #345d46;border-bottom:2px solid #345d46;color:#173e2b;padding-top:13px;padding-bottom:13px}' +
      '.negative th,.negative td{color:#9d2424;background:#fff0f0;border-color:#b65858}' +
      '.report-notes{margin-top:24px;padding-top:13px;border-top:1px solid #cfd8e0;font-size:12px;color:#52616d;break-inside:avoid}.report-notes p{margin:5px 0}.report-notes b{color:#344653}' +
      '@page{size:' + (paper === 'letter' ? 'letter' : 'A4') + ' portrait;margin:14mm}' +
      '@media print{html,body{background:#fff;margin:0;padding:0}.report{width:auto;max-width:none;box-shadow:none;margin:0;padding:0}th,td{-webkit-print-color-adjust:exact;print-color-adjust:exact}.report-header{break-after:avoid}.statement{margin-top:16px}}' +
      '@media screen and (max-width:600px){body{padding:8px}.report{padding:18px}.metadata{grid-template-columns:1fr}.brand{font-size:20px}.statement th,.statement td{padding-left:5px;padding-right:5px}.description-col{width:58%}.amount-col{width:42%}.amount{font-size:12px}.net td{font-size:14px}}' +
      '</style></head><body><main class="report"><header class="report-header"><div class="brand">' + esc(name) + '</div><h1 class="report-title">Executive Financial Report</h1>' +
      '<div class="metadata"><div><span>BRANCH</span><b>' + esc(report.branch || 'Selected branch') + '</b></div><div><span>REPORTING PERIOD</span><b>' + esc(report.period) + '</b></div>' +
      '<div><span>GENERATED</span><b>' + esc(report.generatedAt || '') + '</b></div><div><span>CURRENCY</span><b>Philippine peso (PHP)</b></div></div></header>' +
      table('SALES REVENUE', 'Service / revenue source', report.salesRows, 'No recorded payments for invoices dated in this period.', [['TOTAL SALES',report.sales,'total']]) +
      table('COST OF SALES', 'Direct cost category', report.costRows, 'No cost of sales recorded in this period.', [['TOTAL COST OF SALES',report.cost,'total'],['GROSS PROFIT',report.gross,'profit']]) +
      table('OPERATING EXPENSES', 'Operating expense category', report.opexRows, 'No operating expenses recorded in this period.', [['TOTAL OPERATING EXPENSES',report.opex,'total'],['NET INCOME',report.net,'net']]) +
      '<footer class="report-notes"><p><b>Report basis:</b> Same data and calculations as Export Executive Excel. Sales use the recorded amount paid on invoices dated within this reporting period. Expenses use their expense dates and saved categories.</p>' +
      '<p>Dashboard cash-received figures use payment dates, so they can differ from this invoice-date report. This print view does not change any financial record.</p>' +
      '<p>Included: ' + report.salesRows.length + ' service / revenue group(s), ' + report.costRows.length + ' direct-cost category group(s), and ' + report.opexRows.length + ' operating-expense category group(s). All Executive report rows are shown; long descriptions wrap in full.</p></footer></main></body></html>';
  }
  function installStyle() {
    if (root.document.getElementById('executivePrintStyle')) return;
    var style = root.document.createElement('style'); style.id = 'executivePrintStyle';
    style.textContent = '.bwc-financial-preview{box-sizing:border-box;width:min(1080px,96vw);max-width:96vw;height:94vh;max-height:94vh;margin:auto;padding:0;border:1px solid #b9c6d1;border-radius:12px;background:#f2f5f7;color:#1c2d3c;box-shadow:0 20px 90px #0005}.bwc-financial-preview::backdrop{background:#142433aa}.bwc-financial-preview[open]{display:flex;flex-direction:column}.bwc-financial-preview .report-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 20px;background:#fff;border-bottom:1px solid #dce3e9;flex-wrap:wrap}.bwc-financial-preview h2{font-size:20px;margin:0}.bwc-financial-preview .report-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.bwc-financial-preview button,.bwc-financial-preview select{font-size:14px;min-height:38px;padding:8px 12px;cursor:pointer}.bwc-financial-preview label{font-size:14px;display:flex;gap:7px;align-items:center}.bwc-financial-preview .report-help{font-size:14px;line-height:1.5;padding:12px 20px;border-bottom:1px solid #dce3e9;margin:0}.bwc-financial-preview .report-status{font-size:14px;padding:12px 20px;margin:0}.bwc-financial-preview .report-status:empty{display:none}.bwc-financial-preview iframe{width:100%;flex:1;min-height:0;border:0;background:#e8edf1}.bwc-financial-preview button:disabled{opacity:.5;cursor:wait}.bwc-financial-preview [hidden]{display:none!important}@media print{.bwc-financial-preview{display:none!important}}';
    // Let the extra report action wrap with the existing filters on narrow screens.
    style.textContent += '#dashboard>.period{flex-wrap:wrap}#dashboard>.period>button{white-space:nowrap;flex:0 0 auto}';
    root.document.head.appendChild(style);
  }
  async function openPreview() {
    if (activeDialog) { activeDialog.focus(); return; }
    var doc = root.document, provider = root.BWCExecutiveReport;
    if (!provider || typeof provider.prepare !== 'function') { root.alert('The financial report is still loading. Please refresh and try again.'); return; }
    installStyle();
    var opener = doc.activeElement, dialog = doc.createElement('dialog'), token = ++requestId;
    dialog.className = 'bwc-financial-preview'; dialog.setAttribute('aria-labelledby', 'financialPrintTitle');
    dialog.innerHTML = '<div class="report-toolbar"><h2 id="financialPrintTitle">Financial report preview</h2><div class="report-actions"><label>Paper<select aria-label="Report paper size"><option value="a4">A4</option><option value="letter">Short bond / Letter</option></select></label><button type="button" class="primary" data-report-print disabled>Print / Save PDF</button><button type="button" class="secondary" data-report-close>Close</button></div></div>' +
      '<p class="report-help">All Executive Excel rows and amounts are included. Long reports continue across printed pages. Choose the matching paper size, Portrait, scale 100%, and turn off browser headers / footers. To save a PDF, choose “Save as PDF” in the print dialog.</p>' +
      '<p class="report-status" role="status">Loading the selected branch and reporting period…</p><iframe title="Financial report print preview" sandbox="allow-same-origin allow-modals" hidden></iframe>';
    doc.body.appendChild(dialog); activeDialog = dialog; dialog.showModal();
    var status = dialog.querySelector('.report-status'), frame = dialog.querySelector('iframe'), printButton = dialog.querySelector('[data-report-print]'), paper = dialog.querySelector('select'), report = null;
    function renderFrame() {
      if (!report || activeDialog !== dialog) return;
      printButton.disabled = true; status.textContent = 'Preparing print layout…';
      frame.onload = function () {
        if (activeDialog === dialog && frame.contentDocument && frame.contentDocument.querySelector('.report')) {
          printButton.disabled = false; status.textContent = '';
        }
      };
      frame.hidden = false; frame.srcdoc = html(report, paper.value);
    }
    dialog.querySelector('[data-report-close]').addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('close', function () { if (activeDialog === dialog) activeDialog = null; dialog.remove(); if (opener && opener.isConnected) opener.focus(); });
    paper.addEventListener('change', renderFrame);
    printButton.addEventListener('click', function () {
      if (printButton.disabled || !report) return;
      try { frame.contentWindow.focus(); frame.contentWindow.print(); }
      catch (error) { status.textContent = 'Printing could not start. Please try again in Chrome or Edge.'; }
    });
    try {
      report = await provider.prepare();
      if (token !== requestId || activeDialog !== dialog) return;
      renderFrame();
    } catch (error) {
      if (activeDialog !== dialog) return;
      frame.hidden = true; printButton.disabled = true; paper.disabled = true;
      status.textContent = 'The financial report could not be prepared: ' + (error && error.message ? error.message : 'Please try again.');
    }
  }
  function install() {
    if (!root || !root.document) return;
    var button = root.document.getElementById('printFinancialReport');
    if (!button || button.dataset.printInstalled) return;
    installStyle();
    button.dataset.printInstalled = 'true'; button.disabled = false;
    button.addEventListener('click', openPreview);
  }
  return {html:html, money:money, install:install, open:openPreview};
}));
