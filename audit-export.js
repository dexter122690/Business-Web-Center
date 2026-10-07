/* Owner-only audit workbook.  It exports the same dated-payment and expense
   data used by the live dashboard, plus the supporting records for review. */
(function () {
  var ready = false;

  function number(value) { return Number(value || 0) || 0; }
  function text(value) { return String(value == null ? '' : value); }
  function escapeXml(value) { return text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
  function money(value) { return 'PHP ' + number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function activeBranch() { return localStorage.getItem('bwc-active-branch') || ''; }
  function activeBusiness() { return localStorage.getItem('bwc-active-business') || ''; }
  function today() { return new Date().toISOString().slice(0, 10); }

  function selection(allRecords) {
    var month = document.getElementById('dm'), year = document.getElementById('dy');
    var from = (document.getElementById('dashboardDateFrom') || {}).value || '';
    var to = (document.getElementById('dashboardDateTo') || {}).value || '';
    var monthName = month && month.options[month.selectedIndex] ? month.options[month.selectedIndex].textContent : 'All months';
    if (allRecords) return { all: true, label: 'All branch records' };
    return { all: false, month: month ? month.value : '', year: year ? year.value : '', from: from, to: to, label: from && to ? from + ' to ' + to : monthName + ' / ' + ((year && year.value) || 'All years') };
  }
  function inPeriod(row, field, period) {
    if (period.all) return true;
    var raw = text(row[field] || '').slice(0, 10);
    if (!raw) return false;
    if (period.from && period.to) return raw >= period.from && raw <= period.to;
    var date = new Date(raw + 'T00:00:00');
    return (!period.month || date.getMonth() === Number(period.month)) && (!period.year || String(date.getFullYear()) === String(period.year));
  }
  function datedTotal(invoice) { return (invoice.invoice_payments || []).reduce(function (sum, payment) { return sum + number(payment.amount); }, 0); }
  function writeoffTotal(invoice) { return (invoice.invoice_balance_writeoffs || []).reduce(function (sum, item) { return sum + number(item.amount); }, 0); }
  function receivedTotal(invoice) { return Math.max(number(invoice.amount_paid), datedTotal(invoice)); }
  function outstanding(invoice) { return Math.max(0, number(invoice.total_amount) - receivedTotal(invoice) - writeoffTotal(invoice)); }
  function missingDate(invoice) { return Math.max(0, number(invoice.amount_paid) - datedTotal(invoice)); }

  async function ownerContext() {
    var db = window.getBusinessSupabaseClient && window.getBusinessSupabaseClient();
    var businessId = activeBusiness();
    if (!db || !businessId) return { owner: false };
    var session = await db.auth.getSession();
    var user = session.data && session.data.session && session.data.session.user;
    if (!user) return { owner: false };
    var membership = await db.from('business_memberships').select('role').eq('business_id', businessId).eq('user_id', user.id).eq('status', 'active').maybeSingle();
    if (!membership.error && membership.data && membership.data.role === 'owner') return { owner: true, db: db, businessId: businessId };
    var business = await db.from('businesses').select('id').eq('id', businessId).eq('created_by', user.id).maybeSingle();
    return { owner: !business.error && !!business.data, db: db, businessId: businessId };
  }

  async function fetchData(context) {
    var branchId = activeBranch();
    if (!branchId) throw new Error('The branch is still loading. Please try again in a moment.');
    var invoices = context.db.from('invoices').select('id,invoice_number,invoice_date,client_name,vehicle_make,plate_number,total_amount,amount_paid,status,payment_method,invoice_payments(id,payment_date,amount,payment_method,reference_number,notes,created_at),invoice_balance_writeoffs(amount,reason,notes,created_at)').eq('business_id', context.businessId).eq('branch_id', branchId).order('invoice_date', { ascending: true }).order('invoice_number', { ascending: true });
    var expenses = context.db.from('expenses').select('id,expense_date,supplier_name,receipt_number,description,category,quantity,unit_amount,payment_method,reference_number,remarks,created_at').eq('business_id', context.businessId).eq('branch_id', branchId).order('expense_date', { ascending: true }).order('created_at', { ascending: true });
    var cash = context.db.from('cash_transactions').select('transaction_date,cash_account,direction,amount,source_key,reference_number,notes,created_at').eq('business_id', context.businessId).eq('branch_id', branchId).order('transaction_date', { ascending: true }).order('created_at', { ascending: true });
    var result = await Promise.all([invoices, expenses, cash]);
    if (result[0].error) throw result[0].error;
    if (result[1].error) throw result[1].error;
    if (result[2].error) throw result[2].error;
    return { invoices: result[0].data || [], expenses: result[1].data || [], cash: result[2].data || [] };
  }

  function cell(value, style, type) {
    return '<Cell' + (style ? ' ss:StyleID="' + style + '"' : '') + '><Data ss:Type="' + (type || (typeof value === 'number' ? 'Number' : 'String')) + '">' + escapeXml(value) + '</Data></Cell>';
  }
  function row(cells, style) { return '<Row' + (style ? ' ss:StyleID="' + style + '"' : '') + '>' + cells.join('') + '</Row>'; }
  function worksheet(name, headers, rows, widths) {
    var table = [];
    table.push(row(headers.map(function (header) { return cell(header, 'Header'); })));
    rows.forEach(function (values) {
      table.push(row(values.map(function (value) {
        var isCurrency = typeof value === 'number';
        return cell(value, isCurrency ? 'Currency' : 'Text');
      })));
    });
    if (!rows.length) table.push(row([cell('No records for this export selection.', 'Muted')].concat(headers.slice(1).map(function () { return cell('', 'Muted'); }))));
    return '<Worksheet ss:Name="' + escapeXml(name) + '"><Table ss:ExpandedColumnCount="' + headers.length + '">' + (widths || []).map(function (width) { return '<Column ss:Width="' + width + '"/>'; }).join('') + table.join('') + '</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet>';
  }
  function workbook(sheets) {
    return '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles>' +
      '<Style ss:ID="Default"><Font ss:FontName="Aptos" ss:Size="10" ss:Color="#1F2937"/></Style>' +
      '<Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#475569" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>' +
      '<Style ss:ID="Text"><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/></Borders></Style>' +
      '<Style ss:ID="Currency"><NumberFormat ss:Format="&quot;PHP&quot; #,##0.00;[Red]-&quot;PHP&quot; #,##0.00"/><Alignment ss:Horizontal="Right"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/></Borders></Style>' +
      '<Style ss:ID="Muted"><Font ss:Italic="1" ss:Color="#64748B"/></Style>' +
      '</Styles>' + sheets.join('') + '</Workbook>';
  }
  function download(xml, name) {
    var blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 3000);
  }

  function buildWorkbook(data, period) {
    var invoices = data.invoices.filter(function (item) { return inPeriod(item, 'invoice_date', period); });
    var payments = [];
    data.invoices.forEach(function (invoice) {
      (invoice.invoice_payments || []).forEach(function (payment) {
        if (inPeriod(payment, 'payment_date', period)) payments.push({ invoice: invoice, payment: payment });
      });
    });
    var expenses = data.expenses.filter(function (item) { return inPeriod(item, 'expense_date', period); });
    var cash = data.cash.filter(function (item) { return inPeriod(item, 'transaction_date', period); });
    var sales = payments.reduce(function (sum, item) { return sum + number(item.payment.amount); }, 0);
    var cost = expenses.filter(function (item) { return item.category === 'Cost of Sales'; }).reduce(function (sum, item) { return sum + number(item.quantity) * number(item.unit_amount); }, 0);
    var opex = expenses.filter(function (item) { return item.category !== 'Cost of Sales'; }).reduce(function (sum, item) { return sum + number(item.quantity) * number(item.unit_amount); }, 0);
    var unpaid = invoices.reduce(function (sum, item) { return sum + outstanding(item); }, 0);
    var check = [
      ['Report selection', period.label, 'Source records in this workbook'],
      ['Cash received (dated payments)', sales, 'Payment ledger'],
      ['Cost of Sales', cost, 'Expense ledger'],
      ['Operating expenses', opex, 'Expense ledger'],
      ['Total recorded expenses', cost + opex, 'Cost of Sales + Operating expenses'],
      ['Cash received less recorded costs and OPEX', sales - cost - opex, 'Cash received - Total recorded expenses'],
      ['Unpaid invoices issued in this period', unpaid, 'Invoice register']
    ];
    var invoiceRows = invoices.map(function (item) { return [
      'INV-' + String(item.invoice_number || '').padStart(5, '0'), item.invoice_date, item.client_name || '', (item.vehicle_make || '') + ' ' + (item.plate_number || ''), number(item.total_amount), receivedTotal(item), writeoffTotal(item), outstanding(item), item.status || ''
    ]; });
    var paymentRows = payments.map(function (item) { return [
      item.payment.payment_date, 'INV-' + String(item.invoice.invoice_number || '').padStart(5, '0'), item.invoice.client_name || '', item.payment.payment_method || '', item.payment.reference_number || '', item.payment.notes || '', number(item.payment.amount)
    ]; });
    var expenseRows = expenses.map(function (item) { var total = number(item.quantity) * number(item.unit_amount); return [item.expense_date, item.supplier_name || '', item.receipt_number || '', item.description || '', item.category || '', number(item.quantity), number(item.unit_amount), total, item.payment_method || '', item.reference_number || '', item.remarks || '']; });
    var cashRows = cash.map(function (item) { return [item.transaction_date, item.cash_account || '', item.direction || '', number(item.amount), item.source_key || '', item.reference_number || '', item.notes || '']; });
    var exceptions = [];
    invoices.forEach(function (item) {
      var missing = missingDate(item), writeoff = writeoffTotal(item), label = 'INV-' + String(item.invoice_number || '').padStart(5, '0');
      if (missing > 0) exceptions.push(['Missing payment date', label, item.client_name || '', missing, 'Marked received without a dated payment. Confirm only if money was truly received.']);
      if (writeoff > 0) exceptions.push(['Closed / written off', label, item.client_name || '', writeoff, 'Owner-approved unremitted or other balance write-off.']);
      if (datedTotal(item) > number(item.total_amount) + 0.001) exceptions.push(['Overpayment check', label, item.client_name || '', datedTotal(item) - number(item.total_amount), 'Dated payments exceed the invoice total.']);
    });
    return workbook([
      worksheet('Dashboard check', ['Measure', 'Amount / period', 'How to verify'], check, [260, 150, 360]),
      worksheet('Invoice register', ['Invoice', 'Invoice date', 'Client', 'Vehicle', 'Invoice total', 'Received', 'Written off', 'Balance', 'Status'], invoiceRows, [80, 82, 170, 130, 95, 95, 95, 95, 120]),
      worksheet('Payment ledger', ['Payment date', 'Invoice', 'Client', 'Method', 'Reference', 'Notes', 'Amount'], paymentRows, [88, 80, 170, 100, 130, 210, 95]),
      worksheet('Expense ledger', ['Expense date', 'Supplier', 'Receipt', 'Item / service', 'Category', 'Quantity', 'Unit amount', 'Total', 'Payment source', 'Reference', 'Remarks'], expenseRows, [88, 150, 90, 200, 130, 65, 92, 92, 105, 120, 200]),
      worksheet('Cash movements', ['Date', 'Cash fund', 'Direction', 'Amount', 'Source key', 'Reference', 'Notes'], cashRows, [88, 90, 75, 95, 260, 140, 220]),
      worksheet('Exceptions', ['Type', 'Invoice', 'Client', 'Amount', 'Owner review needed'], exceptions, [150, 85, 180, 95, 330])
    ]);
  }

  async function exportAudit(allRecords, button) {
    button.disabled = true;
    var original = button.textContent;
    button.textContent = 'Preparing audit workbook...';
    try {
      var context = await ownerContext();
      if (!context.owner) throw new Error('Only the business owner can export the audit workbook.');
      var period = selection(allRecords), data = await fetchData(context), xml = buildWorkbook(data, period);
      download(xml, '15m-audit-' + (allRecords ? 'all-records' : 'selected-period') + '-' + today() + '.xls');
      alert('Audit workbook downloaded. It includes the dashboard check and the detailed supporting records.');
    } catch (error) {
      alert('The audit workbook could not be prepared: ' + (error && error.message ? error.message : 'Please try again.'));
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function install() {
    if (ready) return;
    var context = await ownerContext();
    if (!context.owner) return;
    var executive = document.querySelector('[onclick*="exportReport"]');
    if (!executive || document.getElementById('auditExportSelected')) return;
    var selected = document.createElement('button'), all = document.createElement('button');
    selected.id = 'auditExportSelected'; selected.type = 'button'; selected.className = 'secondary'; selected.textContent = 'Export Audit Excel — Selected Period';
    all.id = 'auditExportAll'; all.type = 'button'; all.className = 'secondary'; all.textContent = 'Export Audit Excel — All Records';
    selected.addEventListener('click', function () { exportAudit(false, selected); });
    all.addEventListener('click', function () { exportAudit(true, all); });
    executive.insertAdjacentElement('afterend', selected);
    selected.insertAdjacentElement('afterend', all);
    ready = true;
  }

  function scheduleInstall() { setTimeout(function () { install().catch(function () {}); }, 350); }
  document.addEventListener('bwc:business-ready', scheduleInstall);
  document.addEventListener('bwc:branch-ready', scheduleInstall);
  window.addEventListener('load', scheduleInstall);
  scheduleInstall();
}());
