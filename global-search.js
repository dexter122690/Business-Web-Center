/* BWC global search (safe first version).
   Searches only records already scoped to the signed-in business and branch.
   It opens the existing record editor/page instead of creating a duplicate. */
(function () {
  'use strict';

  var input, panel, shell, results = [], selected = -1, remoteLoaded = false, remoteLoading = false;
  var remoteInvoices = null, remoteExpenses = null, cacheTrusted = false;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function text(value) { return String(value == null ? '' : value).trim(); }
  function lower(value) { return text(value).toLowerCase(); }
  function compact(value) { return lower(value).replace(/[\s-]/g, ''); }
  function money(value) {
    return 'PHP ' + (Number(value || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function readRows(key) {
    try {
      var value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (error) { return []; }
  }

  function invoicesFromCache() {
    if (remoteInvoices) return remoteInvoices;
    if (!cacheTrusted) return [];
    return readRows('15m-replica-invoices').map(function (row) {
      return {
        id: row.id,
        number: row.number || ('INV-' + String(row.id || '').padStart(5, '0')),
        client: row.client || row.client_name || '',
        contact: row.contact || row.contact_number || '',
        address: row.address || row.client_address || '',
        email: row.email || row.client_email || '',
        make: row.make || row.vehicle_make || '',
        yearModel: row.yearModel || row.vehicle_year_model || '',
        color: row.color || row.vehicle_color || '',
        plate: row.plate || row.plate_number || '',
        date: row.date || row.invoice_date || '',
        total: row.total == null ? row.total_amount : row.total,
        services: row.services || row.invoice_services || [],
        parts: row.parts || row.invoice_parts || [],
        source: row.source || row.client_source || '',
        admin: row.admin || row.assigned_admin || '',
        remoteId: row.remoteId || row.id
      };
    });
  }

  function expensesFromCache() {
    if (remoteExpenses) return remoteExpenses;
    if (!cacheTrusted) return [];
    return readRows('15m-recovery-expenses').map(function (row) {
      return {
        id: row.remoteId || row.id,
        supplier: row.supplier || row.supplier_name || '',
        receipt: row.receiptNumber || row.receipt_number || '',
        description: row.description || '',
        category: row.category || '',
        reference: row.reference || row.reference_number || '',
        payment: row.payment || row.payment_method || '',
        date: row.date || row.expense_date || '',
        amount: Number(row.amount || row.unit_amount || 0) * Number(row.quantity || 1)
      };
    });
  }

  function mapInvoice(row) {
    var services = (row.invoice_services || []).map(function (item) {
      return { name: item.service_name || item.n || '', detail: item.service_detail || item.d || '' };
    });
    var parts = (row.invoice_parts || []).map(function (item) {
      return { name: item.part_name || item.n || '' };
    });
    return {
      id: row.invoice_number || row.id,
      number: 'INV-' + String(row.invoice_number || '').padStart(5, '0'),
      client: row.client_name || '', contact: row.contact_number || '', address: row.client_address || '',
      email: row.client_email || '', make: row.vehicle_make || '', yearModel: row.vehicle_year_model || '',
      color: row.vehicle_color || '', plate: row.plate_number || '', date: row.invoice_date || '',
      total: Number(row.total_amount || 0), services: services, parts: parts,
      source: row.client_source || '', admin: row.assigned_admin || '', remoteId: row.id
    };
  }

  function mapExpense(row) {
    return {
      id: row.id, supplier: row.supplier_name || '', receipt: row.receipt_number || '',
      description: row.description || '', category: row.category || '', reference: row.reference_number || '',
      payment: row.payment_method || '', date: row.expense_date || '',
      amount: Number(row.unit_amount || 0) * Number(row.quantity || 1)
    };
  }

  function invoiceSearchText(row) {
    var services = (row.services || []).map(function (item) { return [item.name || item.n, item.detail || item.d].join(' '); }).join(' ');
    var parts = (row.parts || []).map(function (item) { return item.name || item.n || ''; }).join(' ');
    return [row.number, row.client, row.contact, row.address, row.email, row.make, row.yearModel,
      row.color, row.plate, row.date, row.source, row.admin, services, parts].join(' ');
  }

  function expenseSearchText(row) {
    return [row.receipt, row.supplier, row.description, row.category, row.reference, row.payment, row.date].join(' ');
  }

  function matches(rowText, query) {
    var q = lower(query);
    return lower(rowText).indexOf(q) >= 0 || (compact(q) && compact(rowText).indexOf(compact(q)) >= 0);
  }

  function clientResults(invoices, query) {
    var seen = {};
    return invoices.filter(function (row) { return matches(invoiceSearchText(row), query); }).reduce(function (list, row) {
      var key = lower(row.client) + '|' + lower(row.contact);
      if (!row.client || seen[key]) return list;
      seen[key] = true;
      list.push({ kind: 'Client', key: key, client: row.client, contact: row.contact, plate: row.plate, invoiceId: row.id });
      return list;
    }, []).slice(0, 4);
  }

  function buildResults(query) {
    var invoices = invoicesFromCache(), expenses = expensesFromCache(), list = [];
    clientResults(invoices, query).forEach(function (row) { list.push(row); });
    invoices.filter(function (row) { return matches(invoiceSearchText(row), query); }).slice(0, 8).forEach(function (row) {
      list.push({ kind: 'Invoice', id: row.id, number: row.number, client: row.client, plate: row.plate,
        date: row.date, total: row.total, invoice: row });
    });
    expenses.filter(function (row) { return matches(expenseSearchText(row), query); }).slice(0, 8).forEach(function (row) {
      list.push({ kind: 'Expense', id: row.id, receipt: row.receipt, supplier: row.supplier,
        description: row.description, date: row.date, amount: row.amount, expense: row });
    });
    return list.slice(0, 16);
  }

  function resultHtml(row, index) {
    var title, detail;
    if (row.kind === 'Client') {
      title = row.client;
      detail = [row.contact, row.plate].filter(Boolean).join(' · ') || 'Open client records';
    } else if (row.kind === 'Invoice') {
      title = row.number + ' · ' + row.client;
      detail = [row.plate, row.date, money(row.total)].filter(Boolean).join(' · ');
    } else {
      title = (row.receipt ? 'Receipt ' + row.receipt + ' · ' : '') + (row.supplier || row.description || 'Expense');
      detail = [row.description, row.date, money(row.amount)].filter(Boolean).join(' · ');
    }
    return '<button type="button" class="bwc-global-result' + (index === selected ? ' is-selected' : '') + '" data-global-result="' + index + '" role="option" aria-selected="' + (index === selected ? 'true' : 'false') + '">' +
      '<span class="bwc-global-result-kind">' + esc(row.kind) + '</span><strong>' + esc(title) + '</strong><small>' + esc(detail) + '</small></button>';
  }

  function render(query, preserveSelection) {
    if (!panel) return;
    var value = text(query);
    if (!preserveSelection) selected = -1;
    if (!value) {
      panel.innerHTML = '<div class="bwc-global-hint">Search clients, plates, invoices, expenses, or receipt numbers.</div>';
      panel.hidden = false;
      return;
    }
    if (value.length < 2) {
      panel.innerHTML = '<div class="bwc-global-hint">Type at least 2 characters.</div>';
      panel.hidden = false;
      return;
    }
    results = buildResults(value);
    panel.innerHTML = results.length ? results.map(resultHtml).join('') : '<div class="bwc-global-hint">No permitted records found.</div>';
    panel.hidden = false;
  }

  function openClient(row) {
    close();
    if (typeof window.show === 'function') window.show('clients');
    setTimeout(function () {
      var field = document.getElementById('masterSearch') || document.getElementById('cmSearch');
      if (!field) return;
      field.value = row.client || '';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, 80);
  }

  function openInvoice(row) {
    close();
    if (typeof window.show === 'function') window.show('invoices');
    setTimeout(function () {
      if (typeof window.editInvoice === 'function') window.editInvoice(row.id);
      if (typeof window.setInvoiceFormMode === 'function') window.setInvoiceFormMode(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 80);
  }

  function openExpense(row, attempt) {
    close();
    if (typeof window.show === 'function') window.show('expenses');
    var button = document.querySelector('[data-edit-expense="' + String(row.id).replace(/"/g, '') + '"]');
    if (button) { button.click(); return; }
    if ((attempt || 0) < 12) setTimeout(function () { openExpense(row, (attempt || 0) + 1); }, 180);
  }

  function activate(index) {
    var row = results[index];
    if (!row) return;
    if (row.kind === 'Client') openClient(row);
    else if (row.kind === 'Invoice') openInvoice(row.invoice);
    else openExpense(row.expense);
  }

  function close() { if (panel) panel.hidden = true; if (input) input.setAttribute('aria-expanded', 'false'); selected = -1; }

  function setupRemoteRefresh() {
    ['bwc:business-ready', 'bwc:branch-ready'].forEach(function (name) {
      document.addEventListener(name, function () { cacheTrusted = false; remoteLoaded = false; remoteInvoices = null; remoteExpenses = null; if (input && text(input.value).length >= 2) render(input.value); });
    });
    ['bwc:invoices-loaded', 'bwc:expenses-loaded', 'bwc:invoice-saved', 'bwc:expense-records-changed'].forEach(function (name) {
      document.addEventListener(name, function () { cacheTrusted = true; remoteLoaded = false; remoteInvoices = null; remoteExpenses = null; if (input && text(input.value).length >= 2) render(input.value); });
    });
    window.addEventListener('storage', function (event) {
      if (event.key !== 'bwc-active-business' && event.key !== 'bwc-active-branch') return;
      cacheTrusted = false; remoteLoaded = false; remoteInvoices = null; remoteExpenses = null;
      if (input && text(input.value).length >= 2) { refreshRemote(); render(input.value); }
    });
  }

  async function refreshRemote() {
    if (remoteLoading || remoteLoaded) return;
    var db = window.getBusinessSupabaseClient && window.getBusinessSupabaseClient();
    var business = localStorage.getItem('bwc-active-business') || '', branch = localStorage.getItem('bwc-active-branch') || '';
    if (!db || !business) return;
    remoteLoading = true;
    try {
      var invoiceQuery = db.from('invoices').select('id,invoice_number,client_name,contact_number,client_address,client_email,vehicle_make,vehicle_year_model,vehicle_color,plate_number,invoice_date,total_amount,client_source,assigned_admin,invoice_services(service_name,service_detail),invoice_parts(part_name)').eq('business_id', business);
      var expenseQuery = db.from('expenses').select('id,expense_date,supplier_name,receipt_number,description,category,quantity,unit_amount,payment_method,reference_number').eq('business_id', business);
      if (branch) { invoiceQuery = invoiceQuery.eq('branch_id', branch); expenseQuery = expenseQuery.eq('branch_id', branch); }
      var response = await Promise.all([invoiceQuery, expenseQuery]);
      if (!response[0].error && !response[1].error) {
        remoteInvoices = (response[0].data || []).map(mapInvoice);
        remoteExpenses = (response[1].data || []).map(mapExpense);
        remoteLoaded = true;
        if (input && text(input.value).length >= 2) render(input.value);
      }
    } catch (error) { /* Cache remains usable when the network is unavailable. */ }
    remoteLoading = false;
  }

  function install() {
    var header = document.querySelector('header'), brand = header && header.querySelector('.brand');
    if (!header || !brand || document.getElementById('bwcGlobalSearch')) return;
    shell = document.createElement('div');
    shell.className = 'bwc-global-search';
    shell.innerHTML = '<span class="bwc-global-search-icon" aria-hidden="true">⌕</span><input id="bwcGlobalSearch" type="search" autocomplete="off" placeholder="Search BWC..." aria-label="Search BWC" aria-controls="bwcGlobalSearchResults" aria-expanded="false"><kbd>Ctrl K</kbd><div id="bwcGlobalSearchResults" class="bwc-global-results" role="listbox" hidden></div>';
    brand.insertAdjacentElement('afterend', shell);
    input = shell.querySelector('input'); panel = shell.querySelector('.bwc-global-results');
    var style = document.createElement('style');
    style.id = 'bwcGlobalSearchStyle';
    style.textContent = '.bwc-global-search{position:relative;flex:1 1 360px;max-width:430px;min-width:220px;margin-left:14px}.bwc-global-search input{height:38px;border:1px solid #5b514d;border-radius:22px;background:#242222;color:#fff;padding:0 60px 0 38px;font-size:13px;outline:0}.bwc-global-search input::placeholder{color:#c9c0bc}.bwc-global-search input:focus{border-color:#ff5219;box-shadow:0 0 0 2px rgba(255,82,25,.25)}.bwc-global-search-icon{position:absolute;z-index:1;left:13px;top:7px;color:#e8dfdb;font-size:23px;line-height:22px;transform:rotate(-20deg);pointer-events:none}.bwc-global-search kbd{position:absolute;right:12px;top:11px;color:#c9c0bc;font:10px Arial;background:#3a3431;border:1px solid #554a45;border-radius:4px;padding:2px 5px}.bwc-global-results{position:absolute;z-index:100;top:45px;left:0;right:0;background:#fff;border:1px solid #decfc7;border-radius:10px;box-shadow:0 14px 32px rgba(0,0,0,.25);padding:5px;max-height:430px;overflow:auto}.bwc-global-result{display:grid;grid-template-columns:auto 1fr;column-gap:8px;width:100%;border:0;background:#fff;text-align:left;padding:9px 10px;border-radius:7px;cursor:pointer;color:#16100d}.bwc-global-result:hover,.bwc-global-result.is-selected{background:#fff0e9}.bwc-global-result-kind{grid-row:1 / span 2;color:#ff5219;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.4px;padding-top:2px}.bwc-global-result strong{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bwc-global-result small{color:#75645d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}.bwc-global-hint{padding:12px;color:#75645d;font-size:11px}.bwc-global-search mark{background:#ffd7c8}@media(max-width:900px){.bwc-global-search{max-width:none;min-width:170px}.bwc-global-search kbd{display:none}}@media(max-width:720px){.bwc-global-search{order:5;flex-basis:100%;margin:4px 0 0}.bwc-global-search input{width:100%}header{flex-wrap:wrap}}';
    document.head.appendChild(style);
    input.addEventListener('focus', function () { refreshRemote(); render(input.value); input.setAttribute('aria-expanded', 'true'); });
    input.addEventListener('input', function () { refreshRemote(); render(input.value); });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { close(); input.blur(); return; }
      if (event.key === 'ArrowDown' && results.length) { event.preventDefault(); selected = (selected + 1) % results.length; render(input.value, true); return; }
      if (event.key === 'ArrowUp' && results.length) { event.preventDefault(); selected = (selected - 1 + results.length) % results.length; render(input.value, true); return; }
      if (event.key === 'Enter' && selected >= 0) { event.preventDefault(); activate(selected); }
    });
    panel.addEventListener('click', function (event) { var button = event.target.closest('[data-global-result]'); if (button) activate(Number(button.dataset.globalResult)); });
    document.addEventListener('click', function (event) { if (!shell.contains(event.target)) close(); });
    document.addEventListener('keydown', function (event) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); input.focus(); input.select(); } });
    setupRemoteRefresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
  window.addEventListener('load', install);
}());
