/* Service repair orders / printable job cards linked to Invoice Making. */
(function () {
  var config = window.BUSINESS_WEB_CENTER_SUPABASE || {};
  var db = null, online = false, rows = [], editingId = '';

  function money(value) { return 'PHP ' + Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function esc(value) { return String(value || '').replace(/[&<>"']/g, function (character) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]; }); }
  function businessId() { return localStorage.getItem('bwc-active-business') || ''; }
  function branchId() { return localStorage.getItem('bwc-active-branch') || ''; }
  function cacheKey() { return 'bwc-repair-orders:' + (businessId() || 'local') + ':' + (branchId() || 'main'); }
  function readLocal() { try { var items = JSON.parse(localStorage.getItem(cacheKey()) || '[]'); return Array.isArray(items) ? items : []; } catch (error) { return []; } }
  function writeLocal(items) { localStorage.setItem(cacheKey(), JSON.stringify(items)); }
  function getInvoices() { return Array.isArray(window.inv) ? window.inv : (typeof inv !== 'undefined' && Array.isArray(inv) ? inv : []); }
  function byInvoice(value) { return getInvoices().find(function (item) { return String(item.remoteId || item.id) === String(value); }); }
  function field(id) { var input = document.getElementById(id); return input ? input.value.trim() : ''; }
  function status(text, error) { var box = document.getElementById('repairOrderStatus'); if (box) { box.textContent = text; box.style.borderLeftColor = error ? '#b63d25' : ''; } }

  async function setup() {
    if (!window.supabase || !config.url || !config.publishableKey) return;
    db = window.businessSupabase || window.supabase.createClient(config.url, config.publishableKey);
    online = true;
    await load();
  }
  async function load() {
    if (!online || !businessId() || !branchId()) { rows = readLocal(); render(); return; }
    var result = await db.from('service_repair_orders').select('*').eq('business_id', businessId()).eq('branch_id', branchId()).order('created_at', { ascending: false });
    if (result.error) {
      rows = readLocal();
      render();
      status('Repair orders are ready. Run migration 018 once to store them securely online.', true);
      return;
    }
    rows = result.data || [];
    writeLocal(rows);
    render();
    status('Repair orders are stored securely for this branch.');
  }
  function defaultInstructions(invoice) {
    var services = (invoice.services || []).map(function (item) { return item.n + (item.d ? ' - ' + item.d : ''); });
    var parts = (invoice.parts || []).map(function (item) { return 'Replace: ' + item.n + ' x ' + item.q; });
    return services.concat(parts).join('\n');
  }
  function selectedOrder() { return rows.find(function (item) { return String(item.id) === String(editingId); }); }
  function chosenInvoice() { return byInvoice(field('repairInvoice')); }
  function invoiceInfo(invoice) {
    var target = document.getElementById('repairInvoiceInfo');
    if (!target) return;
    if (!invoice) { target.innerHTML = '<span class="muted">Choose an invoice to fill in the client, vehicle, services, and promise date.</span>'; return; }
    target.innerHTML = '<b>' + esc(invoice.number) + '</b><br>' + esc(invoice.client) + ' · ' + esc([invoice.make, invoice.yearModel, invoice.color, invoice.plate].filter(Boolean).join(' ')) + '<br><small>Invoice total: ' + money(invoice.total) + ' · Assigned admin: ' + esc(invoice.admin || 'Not assigned') + '</small>';
  }
  function repairForm(order) {
    var invoiceOptions = getInvoices().map(function (invoice) { var id = invoice.remoteId || invoice.id; return '<option value="' + esc(id) + '" ' + (order && String(order.invoice_id) === String(id) ? 'selected' : '') + '>' + esc(invoice.number + ' - ' + invoice.client + ' - ' + invoice.plate) + '</option>'; }).join('');
    return '<div class="card" id="repairOrderCard" style="margin-top:14px"><div class="heading" style="margin-top:0"><div><div class="k">Service repair order</div><h2>' + (order ? 'Edit repair order' : 'Create a repair order') + '</h2><p class="muted">Use the invoice as the source for the client, vehicle, assigned admin, service work, and promised release date.</p></div></div><div class="formgrid"><label class="full">Invoice *<select id="repairInvoice"><option value="">Select invoice</option>' + invoiceOptions + '</select></label><div id="repairInvoiceInfo" class="notice full"></div><label>Contractor / assigned worker *<input id="repairContractor" placeholder="Assigned admin or contractor" value="' + esc(order ? order.contractor : '') + '"></label><label>Labor cost (PHP)<input id="repairLaborCost" type="number" min="0" step=".01" value="' + Number(order ? order.labor_cost : 0) + '"></label><label>Promise / completion date<input id="repairPromiseDate" type="date" value="' + esc(order && order.promise_date ? order.promise_date : '') + '"></label><label>Status<select id="repairStatus"><option ' + (order && order.status === 'Open' ? 'selected' : '') + '>Open</option><option ' + (order && order.status === 'In progress' ? 'selected' : '') + '>In progress</option><option ' + (order && order.status === 'Completed' ? 'selected' : '') + '>Completed</option><option ' + (order && order.status === 'Cancelled' ? 'selected' : '') + '>Cancelled</option></select></label><label class="full">Job instructions<textarea id="repairInstructions" rows="8" placeholder="List the repair panels, paint/tinsmith work, replacement parts, and special instructions.">' + esc(order ? order.job_instructions : '') + '</textarea></label><label class="full">Remarks<textarea id="repairRemarks" rows="3" placeholder="Insurance details, hidden-damage note, client requests, paint instructions, and other remarks.">' + esc(order ? order.remarks : '') + '</textarea></label></div><div class="actions" style="margin-top:12px"><button class="primary" type="button" data-repair-save="1">' + (order ? 'Save repair order changes' : 'Create repair order') + '</button>' + (order ? '<button class="secondary" type="button" data-repair-cancel="1">Cancel</button>' : '') + '</div><div id="repairOrderStatus" class="notice" style="margin-top:12px"></div></div>';
  }
  function orderRows() {
    if (!rows.length) return '<div class="empty">No service repair orders have been created in this branch yet.</div>';
    return '<table><thead><tr><th>Repair order</th><th>Invoice</th><th>Client / vehicle</th><th>Contractor</th><th>Promise date</th><th>Status</th><th>Action</th></tr></thead><tbody>' + rows.map(function (order) { var invoice = byInvoice(order.invoice_id), title = invoice ? invoice.client + ' · ' + [invoice.make, invoice.plate].filter(Boolean).join(' ') : 'Linked invoice'; return '<tr><td><b>SRO-' + String(order.repair_order_number || order.id).slice(-6).toUpperCase() + '</b></td><td>' + esc(invoice ? invoice.number : 'Invoice record') + '</td><td>' + esc(title) + '</td><td>' + esc(order.contractor) + '</td><td>' + esc(order.promise_date || '—') + '</td><td><span class="badge">' + esc(order.status) + '</span></td><td class="actions"><button class="secondary" data-repair-edit="' + esc(order.id) + '">Edit</button><button class="secondary" data-repair-print="' + esc(order.id) + '">Print</button></td></tr>'; }).join('') + '</tbody></table>';
  }
  function render() {
    var root = document.getElementById('invoices'); if (!root) return;
    var old = document.getElementById('repairOrderArea');
    var order = selectedOrder();
    var area = document.createElement('div'); area.id = 'repairOrderArea';
    area.innerHTML = repairForm(order) + '<div class="card" style="margin-top:14px"><div class="k">Repair order register</div><h2>Printable job cards</h2><div style="overflow:auto">' + orderRows() + '</div></div>';
    if (old) old.replaceWith(area); else root.appendChild(area);
    var invoiceSelect = document.getElementById('repairInvoice');
    if (invoiceSelect) {
      if (order) invoiceSelect.value = order.invoice_id;
      var invoice = chosenInvoice();
      if (!order && invoice) fillFromInvoice(invoice);
      invoiceInfo(invoice);
    }
  }
  function fillFromInvoice(invoice) {
    var contractor = document.getElementById('repairContractor'), promise = document.getElementById('repairPromiseDate'), instructions = document.getElementById('repairInstructions');
    if (contractor && !contractor.value) contractor.value = invoice.admin || '';
    if (promise && !promise.value) promise.value = invoice.release || '';
    if (instructions && !instructions.value) instructions.value = defaultInstructions(invoice);
    invoiceInfo(invoice);
  }
  async function save() {
    var invoice = chosenInvoice(), contractor = field('repairContractor'), instructions = field('repairInstructions');
    if (!invoice || !contractor || !instructions) { alert('Choose an invoice, enter the contractor or assigned worker, and add job instructions.'); return; }
    var account = online && db ? (await db.auth.getUser()).data.user : null;
    var payload = { invoice_id: invoice.remoteId || invoice.id, contractor: contractor, labor_cost: Number(field('repairLaborCost') || 0), promise_date: field('repairPromiseDate') || null, job_instructions: instructions, remarks: field('repairRemarks'), status: field('repairStatus') || 'Open' };
    if (!online || !businessId() || !branchId() || !account) {
      if (editingId) { var index = rows.findIndex(function (item) { return String(item.id) === String(editingId); }); if (index >= 0) rows[index] = Object.assign(rows[index], payload); }
      else rows.unshift(Object.assign({ id: 'local-' + Date.now(), repair_order_number: rows.length + 1 }, payload));
      writeLocal(rows); editingId = ''; render(); status('Repair order saved in this browser. Sign in and run migration 018 for secure online storage.', true); return;
    }
    payload.business_id = businessId(); payload.branch_id = branchId();
    try {
      var result;
      if (editingId) result = await db.from('service_repair_orders').update(payload).eq('id', editingId).eq('business_id', businessId()).eq('branch_id', branchId()).select().single();
      else { payload.created_by = account.id; result = await db.from('service_repair_orders').insert(payload).select().single(); }
      if (result.error) throw result.error;
      editingId = ''; await load(); alert('Service repair order saved securely online.');
    } catch (error) { status('Repair order could not save online: ' + error.message, true); alert('The repair order could not be saved online. Run migration 018 first, then try again.'); }
  }
  function print(order) {
    var invoice = byInvoice(order.invoice_id), brand = { company: 'Your Business Name' }, contact = { address: '', phone: '', email: '' }, theme = { accent: '#ff5219', text: '#16100d' };
    try { brand = Object.assign(brand, JSON.parse(localStorage.getItem('15m-custom-header') || '{}')); contact = Object.assign(contact, JSON.parse(localStorage.getItem('15m-business-contact') || '{}')); theme = Object.assign(theme, JSON.parse(localStorage.getItem('15m-brand-theme') || '{}')); } catch (error) {}
    var logo = localStorage.getItem('15m-custom-logo') || '', identity = logo ? '<img src="' + esc(logo) + '">' : '<b>logo</b>', services = (invoice && invoice.services || []).map(function (item) { return '<li>' + esc(item.n + (item.d ? ' - ' + item.d : '')) + '</li>'; }).join('');
    var win = window.open('', '_blank'); if (!win) { alert('Allow pop-ups to print the repair order.'); return; }
    win.document.write('<!doctype html><html><head><title>Service Repair Order</title><style>@page{margin:.45in}body{font:12px Arial;color:' + theme.text + '} .head{display:flex;gap:12px;align-items:center;border-bottom:3px solid ' + theme.accent + ';padding-bottom:10px}.head img{max-width:70px;max-height:55px;object-fit:contain}.title{margin-left:auto;text-align:right;color:' + theme.accent + ';font-weight:bold;font-size:17px}table{width:100%;border-collapse:collapse;margin-top:12px}td,th{border:1px solid #444;padding:7px;text-align:left;vertical-align:top}th{width:26%;background:#faf7f5}.section{margin-top:18px;border:1px solid #444}.section h3{margin:0;padding:7px;background:#f4eee9;border-bottom:1px solid #444}.section pre{white-space:pre-wrap;font:12px Arial;padding:8px;margin:0;min-height:110px}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:55px;margin-top:55px;text-align:center}.signatures div{border-top:1px solid #222;padding-top:6px}</style></head><body><div class="head"><div>' + identity + '</div><div><b style="font-size:18px">' + esc(brand.company) + '</b><br>' + esc(contact.address) + '<br>' + esc(contact.phone) + (contact.email ? '<br>' + esc(contact.email) : '') + '</div><div class="title">SERVICE REPAIR ORDER<br><small style="color:#222">SRO-' + esc(String(order.repair_order_number || order.id).slice(-6).toUpperCase()) + '</small></div></div><table><tr><th>Repair order date</th><td>' + esc(String(order.created_at || new Date().toISOString()).slice(0, 10)) + '</td><th>Contractor</th><td>' + esc(order.contractor) + '</td></tr><tr><th>Repair order no.</th><td>SRO-' + esc(String(order.repair_order_number || order.id).slice(-6).toUpperCase()) + '</td><th>Labor cost</th><td>' + money(order.labor_cost) + '</td></tr><tr><th>Customer name</th><td>' + esc(invoice && invoice.client) + '</td><th>Promise date</th><td>' + esc(order.promise_date || '') + '</td></tr><tr><th>Mobile no.</th><td>' + esc(invoice && invoice.contact) + '</td><th>Plate no.</th><td>' + esc(invoice && invoice.plate) + '</td></tr><tr><th>Vehicle</th><td colspan="3">' + esc(invoice && [invoice.yearModel, invoice.make, invoice.color].filter(Boolean).join(' ')) + '</td></tr></table><div class="section"><h3>Job instructions</h3><pre>' + esc(order.job_instructions) + '</pre></div><div class="section"><h3>Invoice services</h3><ul>' + (services || '<li>No service lines found.</li>') + '</ul></div><div class="section"><h3>Remarks</h3><pre>' + esc(order.remarks || '') + '</pre></div><div class="signatures"><div>Approved by</div><div>' + esc(invoice && invoice.client || 'Client') + '<br><small>Client approval</small></div></div></body></html>');
    win.document.close(); setTimeout(function () { win.print(); }, 150);
  }
  document.addEventListener('change', function (event) { if (event.target.id === 'repairInvoice') { fillFromInvoice(chosenInvoice()); } });
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-repair-save],[data-repair-edit],[data-repair-print],[data-repair-cancel]'); if (!button) return;
    if (button.dataset.repairSave !== undefined) { event.preventDefault(); save(); }
    if (button.dataset.repairEdit) { editingId = button.dataset.repairEdit; render(); }
    if (button.dataset.repairPrint) { var order = rows.find(function (item) { return String(item.id) === String(button.dataset.repairPrint); }); if (order) print(order); }
    if (button.dataset.repairCancel !== undefined) { editingId = ''; render(); }
  }, true);
  document.addEventListener('bwc:invoices-loaded', function () { setTimeout(function () { load(); }, 80); });
  document.addEventListener('bwc:branch-ready', function () { setTimeout(function () { load(); }, 180); });
  document.addEventListener('click', function (event) { if (event.target.closest('[data-t="invoices"],[data-restore-tab="invoices"]')) setTimeout(render, 150); });
  window.addEventListener('load', function () { setTimeout(function () { render(); setup(); }, 750); });
}());
