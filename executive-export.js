/* Branded executive Excel export. Uses the same invoice and expense records
   as the online dashboard, then creates a styled Excel-compatible workbook. */
(function () {
  function number(value) { return Number(value || 0) || 0; }
  function escapeXml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function color(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
  }
  function activePeriod() {
    var monthEl = document.getElementById('dm');
    var yearEl = document.getElementById('dy');
    var month = monthEl ? monthEl.value : '';
    var year = yearEl ? yearEl.value : '';
    var monthName = 'All months';
    if (month && monthEl && monthEl.options[monthEl.selectedIndex]) monthName = monthEl.options[monthEl.selectedIndex].textContent;
    return { month: month, year: year, label: monthName + ' / ' + (year || 'All years') };
  }
  function inPeriod(row, selection) {
    var raw = row.invoice_date || row.expense_date || row.date;
    if (!raw) return false;
    var date = new Date(raw + 'T00:00:00');
    return (!selection.month || date.getMonth() === Number(selection.month)) &&
      (!selection.year || String(date.getFullYear()) === String(selection.year));
  }
  function sum(rows, field) {
    return rows.reduce(function (total, row) { return total + number(typeof field === 'function' ? field(row) : row[field]); }, 0);
  }
  function group(rows, nameFor, amountFor) {
    var result = {};
    rows.forEach(function (row) {
      var name = nameFor(row) || 'Uncategorised';
      result[name] = (result[name] || 0) + number(amountFor(row));
    });
    return Object.keys(result).sort().map(function (name) { return [name, result[name]]; });
  }
  function readBrand() {
    var settings = {};
    try { settings = JSON.parse(localStorage.getItem('15m-branding') || localStorage.getItem('bwc-branding') || '{}'); } catch (error) {}
    var title = settings.businessName || settings.name || (document.querySelector('.brand h1') || {}).textContent || (document.querySelector('header h1') || {}).textContent || 'Business Web Center';
    title = String(title || 'Business Web Center').trim();
    return {
      name: title,
      accent: color(settings.primaryAccent || settings.accent || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), '#FF5A1F'),
      dark: color(settings.headerColor || getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(), '#1F2937')
    };
  }
  async function getRows() {
    var config = window.BUSINESS_WEB_CENTER_SUPABASE || {};
    var db = window.businessSupabase || (window.supabase && config.url && config.publishableKey && window.supabase.createClient(config.url, config.publishableKey));
    var businessId = localStorage.getItem('bwc-active-business') || '';
    var branchId = localStorage.getItem('bwc-active-branch') || '';
    if (!db || !businessId) throw new Error('Your online workspace is still loading. Please try again in a moment.');
    var invoiceQuery = db.from('invoices').select('invoice_date,total_amount,amount_paid,invoice_services(service_name,amount)').eq('business_id', businessId);
    var expenseQuery = db.from('expenses').select('expense_date,category,quantity,unit_amount').eq('business_id', businessId);
    if (branchId) { invoiceQuery = invoiceQuery.eq('branch_id', branchId); expenseQuery = expenseQuery.eq('branch_id', branchId); }
    var result = await Promise.all([invoiceQuery, expenseQuery]);
    if (result[0].error) throw result[0].error;
    if (result[1].error) throw result[1].error;
    return { invoices: result[0].data || [], expenses: result[1].data || [] };
  }
  function cell(value, style, type) {
    var dataType = type || (typeof value === 'number' ? 'Number' : 'String');
    return '<Cell' + (style ? ' ss:StyleID="' + style + '"' : '') + '><Data ss:Type="' + dataType + '">' + escapeXml(value) + '</Data></Cell>';
  }
  function row(cells, style) { return '<Row' + (style ? ' ss:StyleID="' + style + '"' : '') + '>' + cells.join('') + '</Row>'; }
  function spreadsheetXml(report) {
    var brand = report.brand, accent = brand.accent, dark = brand.dark;
    var rows = [];
    rows.push(row([cell(brand.name, 'Title'), cell('', 'Title'), cell('', 'Title')], 'Title'));
    rows.push(row([cell('EXECUTIVE FINANCIAL REPORT', 'Subtitle'), cell('', 'Subtitle'), cell('', 'Subtitle')], 'Subtitle'));
    rows.push(row([cell('Reporting period', 'MetaLabel'), cell(report.period, 'MetaValue'), cell('Generated ' + new Date().toLocaleString('en-PH'), 'MetaValue')]));
    rows.push(row([cell('', ''), cell('', ''), cell('', '')]));
    rows.push(row([cell('SALES REVENUE', 'Section'), cell('', 'Section'), cell('', 'Section')], 'Section'));
    rows.push(row([cell('Service / revenue source', 'Header'), cell('Amount (PHP)', 'Header'), cell('', 'Header')]));
    if (report.salesRows.length) report.salesRows.forEach(function (line) { rows.push(row([cell(line[0], 'Text'), cell(line[1], 'Currency'), cell('', 'Text')])); });
    else rows.push(row([cell('No invoice payments received in this period.', 'Muted'), cell(0, 'Currency'), cell('', 'Muted')]));
    rows.push(row([cell('TOTAL SALES', 'Total'), cell(report.sales, 'TotalCurrency'), cell('', 'Total')]));
    rows.push(row([cell('', ''), cell('', ''), cell('', '')]));
    rows.push(row([cell('COST OF SALES', 'Section'), cell('', 'Section'), cell('', 'Section')], 'Section'));
    rows.push(row([cell('Direct cost category', 'Header'), cell('Amount (PHP)', 'Header'), cell('', 'Header')]));
    if (report.costRows.length) report.costRows.forEach(function (line) { rows.push(row([cell(line[0], 'Text'), cell(line[1], 'Currency'), cell('', 'Text')])); });
    else rows.push(row([cell('No cost of sales recorded in this period.', 'Muted'), cell(0, 'Currency'), cell('', 'Muted')]));
    rows.push(row([cell('TOTAL COST OF SALES', 'Total'), cell(report.cost, 'TotalCurrency'), cell('', 'Total')]));
    rows.push(row([cell('GROSS PROFIT', 'Profit'), cell(report.gross, 'ProfitCurrency'), cell('', 'Profit')]));
    rows.push(row([cell('', ''), cell('', ''), cell('', '')]));
    rows.push(row([cell('OPERATING EXPENSES', 'Section'), cell('', 'Section'), cell('', 'Section')], 'Section'));
    rows.push(row([cell('Operating expense category', 'Header'), cell('Amount (PHP)', 'Header'), cell('', 'Header')]));
    if (report.opexRows.length) report.opexRows.forEach(function (line) { rows.push(row([cell(line[0], 'Text'), cell(line[1], 'Currency'), cell('', 'Text')])); });
    else rows.push(row([cell('No operating expenses recorded in this period.', 'Muted'), cell(0, 'Currency'), cell('', 'Muted')]));
    rows.push(row([cell('TOTAL OPERATING EXPENSES', 'Total'), cell(report.opex, 'TotalCurrency'), cell('', 'Total')]));
    rows.push(row([cell('NET INCOME', report.net >= 0 ? 'Net' : 'Loss'), cell(report.net, report.net >= 0 ? 'NetCurrency' : 'LossCurrency'), cell('', report.net >= 0 ? 'Net' : 'Loss')]));
    rows.push(row([cell('', ''), cell('', ''), cell('', '')]));
    rows.push(row([cell('Notes', 'NoteTitle'), cell('Sales use recorded invoice payments for the selected period. Cost of sales and operating expenses use the categories saved in Expenses.', 'Note'), cell('', 'Note')]));
    return '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
      '<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Title>Executive Financial Report</Title><Author>' + escapeXml(brand.name) + '</Author></DocumentProperties>' +
      '<Styles>' +
      '<Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Aptos" ss:Size="10" ss:Color="#1F2937"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/></Style>' +
      '<Style ss:ID="Title"><Font ss:Bold="1" ss:Size="18" ss:Color="#FFFFFF"/><Interior ss:Color="' + dark + '" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>' +
      '<Style ss:ID="Subtitle"><Font ss:Bold="1" ss:Size="11" ss:Color="#FFFFFF"/><Interior ss:Color="' + dark + '" ss:Pattern="Solid"/></Style>' +
      '<Style ss:ID="MetaLabel"><Font ss:Bold="1" ss:Color="' + accent + '"/><Interior ss:Color="#FFF4EE" ss:Pattern="Solid"/></Style><Style ss:ID="MetaValue"><Interior ss:Color="#FFF4EE" ss:Pattern="Solid"/></Style>' +
      '<Style ss:ID="Section"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="' + accent + '" ss:Pattern="Solid"/></Style>' +
      '<Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#475569" ss:Pattern="Solid"/><Alignment ss:Horizontal="Left"/></Style>' +
      '<Style ss:ID="Text"><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/></Borders></Style>' +
      '<Style ss:ID="Currency"><NumberFormat ss:Format="&quot;PHP&quot; #,##0.00;[Red]-&quot;PHP&quot; #,##0.00"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/></Borders><Alignment ss:Horizontal="Right"/></Style>' +
      '<Style ss:ID="Total"><Font ss:Bold="1"/><Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/></Style><Style ss:ID="TotalCurrency"><Font ss:Bold="1"/><Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/><NumberFormat ss:Format="&quot;PHP&quot; #,##0.00;[Red]-&quot;PHP&quot; #,##0.00"/><Alignment ss:Horizontal="Right"/></Style>' +
      '<Style ss:ID="Profit"><Font ss:Bold="1" ss:Color="#14532D"/><Interior ss:Color="#DCFCE7" ss:Pattern="Solid"/></Style><Style ss:ID="ProfitCurrency"><Font ss:Bold="1" ss:Color="#14532D"/><Interior ss:Color="#DCFCE7" ss:Pattern="Solid"/><NumberFormat ss:Format="&quot;PHP&quot; #,##0.00;[Red]-&quot;PHP&quot; #,##0.00"/><Alignment ss:Horizontal="Right"/></Style>' +
      '<Style ss:ID="Net"><Font ss:Bold="1" ss:Size="12" ss:Color="#FFFFFF"/><Interior ss:Color="#16A34A" ss:Pattern="Solid"/></Style><Style ss:ID="NetCurrency"><Font ss:Bold="1" ss:Size="12" ss:Color="#FFFFFF"/><Interior ss:Color="#16A34A" ss:Pattern="Solid"/><NumberFormat ss:Format="&quot;PHP&quot; #,##0.00;[Red]-&quot;PHP&quot; #,##0.00"/><Alignment ss:Horizontal="Right"/></Style>' +
      '<Style ss:ID="Loss"><Font ss:Bold="1" ss:Size="12" ss:Color="#FFFFFF"/><Interior ss:Color="#DC2626" ss:Pattern="Solid"/></Style><Style ss:ID="LossCurrency"><Font ss:Bold="1" ss:Size="12" ss:Color="#FFFFFF"/><Interior ss:Color="#DC2626" ss:Pattern="Solid"/><NumberFormat ss:Format="&quot;PHP&quot; #,##0.00;[Red]-&quot;PHP&quot; #,##0.00"/><Alignment ss:Horizontal="Right"/></Style>' +
      '<Style ss:ID="Muted"><Font ss:Italic="1" ss:Color="#64748B"/></Style><Style ss:ID="NoteTitle"><Font ss:Bold="1" ss:Color="#475569"/><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/></Style><Style ss:ID="Note"><Font ss:Italic="1" ss:Color="#475569"/><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/></Style>' +
      '</Styles><Worksheet ss:Name="Financial Summary"><Table ss:ExpandedColumnCount="3">' +
      '<Column ss:Width="290"/><Column ss:Width="125"/><Column ss:Width="190"/>' + rows.join('') +
      '</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>5</SplitHorizontal><TopRowBottomPane>5</TopRowBottomPane><ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios></WorksheetOptions></Worksheet></Workbook>';
  }
  async function exportReport() {
    var button = document.querySelector('[onclick*="exportReport"]');
    if (button) { button.disabled = true; button.textContent = 'Preparing report...'; }
    try {
      var data = await getRows(), selection = activePeriod(), brand = readBrand();
      var invoices = data.invoices.filter(function (row) { return inPeriod(row, selection); });
      var expenses = data.expenses.filter(function (row) { return inPeriod(row, selection); });
      var sales = sum(invoices, 'amount_paid');
      var salesRows = group(invoices.filter(function (invoice) { return number(invoice.amount_paid) > 0; }), function (invoice) {
        return (invoice.invoice_services || []).map(function (line) { return line.service_name; }).filter(Boolean).join(' + ') || 'Invoice payment';
      }, 'amount_paid');
      var costItems = expenses.filter(function (expense) { return expense.category === 'Cost of Sales'; });
      var opexItems = expenses.filter(function (expense) { return expense.category !== 'Cost of Sales'; });
      var cost = sum(costItems, function (expense) { return number(expense.quantity) * number(expense.unit_amount); });
      var opex = sum(opexItems, function (expense) { return number(expense.quantity) * number(expense.unit_amount); });
      var report = { brand: brand, period: selection.label, sales: sales, cost: cost, gross: sales - cost, opex: opex, net: sales - cost - opex, salesRows: salesRows, costRows: group(costItems, function (expense) { return expense.category || 'Cost of Sales'; }, function (expense) { return number(expense.quantity) * number(expense.unit_amount); }), opexRows: group(opexItems, function (expense) { return expense.category || 'Other'; }, function (expense) { return number(expense.quantity) * number(expense.unit_amount); }) };
      var blob = new Blob([spreadsheetXml(report)], { type: 'application/vnd.ms-excel;charset=utf-8' });
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'executive-financial-report-' + new Date().toISOString().slice(0, 10) + '.xls';
      document.body.appendChild(link);
      link.click();
      setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 3000);
      alert('Executive financial report downloaded. You can open this Excel file directly or upload it to Google Drive and open it with Google Sheets.');
    } catch (error) {
      alert('The executive report could not be prepared: ' + (error && error.message ? error.message : 'Please try again.'));
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Export Executive Excel'; }
    }
  }
  window.exportReport = exportReport;
}());
