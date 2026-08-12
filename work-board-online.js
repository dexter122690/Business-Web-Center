/* Automatic Work Board.  It reads the current business + branch records; it
   never copies another branch's invoices, schedules, workers, or stock use. */
(function () {
  var db, online = false, rows = [], loading = false;
  var statuses = ['Received', 'In Progress', 'Quality Check', 'Ready for Release', 'Completed'];
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function business() { return localStorage.getItem('bwc-active-business') || ''; }
  function branch() { return localStorage.getItem('bwc-active-branch') || ''; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function label(date) { return date ? new Date(date + 'T00:00:00').toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'}) : 'No target date'; }
  function daysSince(date) { return date ? Math.max(0, Math.floor((new Date(today() + 'T00:00:00') - new Date(date + 'T00:00:00')) / 86400000)) : 0; }
  function invoiceNumber(value) { return 'INV-' + String(value || '').padStart(5, '0'); }
  function activate() {
    ensureUi();
    document.querySelectorAll('.view').forEach(function (page) { page.classList.toggle('active', page.id === 'workboard'); });
    var button = document.getElementById('workBoardTab');
    document.querySelectorAll('#nav button').forEach(function (item) { item.classList.toggle('active', item === button); });
    localStorage.setItem('bwc-last-open-tab:' + (business() || 'local') + ':' + (branch() || 'main'), 'workboard');
    load();
  }
  function ensureUi() {
    var nav = document.getElementById('nav'), main = document.querySelector('main');
    if (!nav || !main) return;
    var page = document.getElementById('workboard');
    if (!page) { page = document.createElement('section'); page.id = 'workboard'; page.className = 'view'; main.appendChild(page); }
    var button = document.getElementById('workBoardTab');
    if (!button) { button = document.createElement('button'); button.type = 'button'; button.id = 'workBoardTab'; button.dataset.restoreTab = 'workboard'; button.textContent = 'Work Board'; button.onclick = activate; nav.appendChild(button); }
  }
  function render(message) {
    var page = document.getElementById('workboard'); if (!page) return;
    if (message) { page.innerHTML = '<div class="heading"><span class="k">WORK BOARD</span><h2>Shop work board</h2><p class="muted">' + esc(message) + '</p></div>'; return; }
    var active = rows.filter(function (r) { return r.status !== 'Completed'; });
    var delayed = active.filter(function (r) { return r.target && r.target < today(); });
    var due = active.filter(function (r) { return r.target && r.target >= today() && r.target <= new Date(Date.now() + 2 * 86400000).toISOString().slice(0,10); });
    var completed = rows.filter(function (r) { return r.status === 'Completed'; });
    function options(row) { return statuses.map(function (s) { return '<option' + (s === row.status ? ' selected' : '') + '>' + s + '</option>'; }).join(''); }
    function table(list, archive) {
      if (!list.length) return '<p class="muted">No ' + (archive ? 'completed' : 'ongoing') + ' units in this branch.</p>';
      return '<div style="overflow:auto"><table><thead><tr><th>UNIT / INVOICE</th><th>PROCEDURE</th><th>ASSIGNED TO</th><th>DATE IN</th><th>TARGET</th><th>DAYS IN SHOP</th><th>STATUS</th><th>MATERIALS USED</th><th>ACTION</th></tr></thead><tbody>' + list.map(function (r) {
        var urgency = r.target && r.target < today() ? 'Delayed' : r.target && r.target <= new Date(Date.now() + 2 * 86400000).toISOString().slice(0,10) ? 'Due soon' : '';
        return '<tr><td><b>' + esc(r.vehicle || 'Vehicle not entered') + '</b><br><small>' + esc(r.number) + ' · ' + esc(r.client) + '</small></td><td>' + esc(r.procedure || 'Service not entered') + '</td><td>' + esc(r.assigned || 'Unassigned') + '</td><td>' + label(r.dateIn) + '</td><td>' + label(r.target) + (urgency ? '<br><span class="badge">' + urgency + '</span>' : '') + '</td><td>' + daysSince(r.dateIn) + '</td><td><select data-work-status="' + esc(r.id) + '">' + options(r) + '</select></td><td>' + esc(r.materials || 'None issued') + '</td><td><button class="secondary" data-work-save="' + esc(r.id) + '">Save</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    }
    page.innerHTML = '<div class="heading"><span class="k">SHOP OPERATIONS</span><h2>Work Board</h2><p class="muted">Automatically follows this branch\'s invoices, schedules, vehicle jobs, workers, and materials issued.</p></div>' +
      '<div class="notice">This board is branch-only. Update the work status here; client, vehicle, and service details stay linked to the original invoice.</div>' +
      '<div class="grid" style="grid-template-columns:repeat(4,minmax(150px,1fr));margin:16px 0"><div class="card"><span class="muted">Ongoing units</span><h2>' + active.length + '</h2></div><div class="card"><span class="muted">Due soon</span><h2>' + due.length + '</h2></div><div class="card"><span class="muted">Delayed</span><h2>' + delayed.length + '</h2></div><div class="card"><span class="muted">Completed archive</span><h2>' + completed.length + '</h2></div></div>' +
      '<div class="card"><span class="k">ONGOING UNITS</span><h2>Current work in the shop</h2>' + table(active, false) + '</div>' +
      '<div class="card" style="margin-top:16px"><span class="k">COMPLETED UNITS</span><h2>Safe completed archive</h2>' + table(completed, true) + '</div>';
  }
  function byInvoice(list, key) { var out = {}; list.forEach(function (r) { if (r[key]) (out[r[key]] || (out[r[key]] = [])).push(r); }); return out; }
  async function load() {
    if (!online || !business() || !branch() || loading) return;
    loading = true; render('Loading branch work records…');
    try {
      var b = business(), br = branch();
      var requests = await Promise.all([
        db.from('invoices').select('id,invoice_number,client_name,vehicle_make,vehicle_year_model,vehicle_color,plate_number,invoice_date,release_date,assigned_admin,status,invoice_services(service_name,service_detail)').eq('business_id', b).eq('branch_id', br).order('invoice_date', {ascending:false}),
        db.from('work_board_units').select('*').eq('business_id', b).eq('branch_id', br),
        db.from('payroll_vehicle_jobs').select('id,invoice_id,worker_id,vehicle,plate_number,service_work,target_completion,client_release_date,status').eq('business_id', b).eq('branch_id', br),
        db.from('payroll_workers').select('id,full_name').eq('business_id', b).eq('branch_id', br),
        db.from('inventory_stock_movements').select('invoice_id,item_name,quantity,movement_type').eq('business_id', b).eq('branch_id', br).eq('movement_type', 'out')
      ]);
      var invoiceResult = requests[0]; if (invoiceResult.error) throw invoiceResult.error;
      if (b !== business() || br !== branch()) return;
      var overrides = {}, jobs = byInvoice(requests[2].data || [], 'invoice_id'), materials = byInvoice(requests[4].data || [], 'invoice_id'), workers = {};
      (requests[1].data || []).forEach(function (x) { overrides[x.invoice_id] = x; });
      (requests[3].data || []).forEach(function (x) { workers[x.id] = x.full_name; });
      rows = (invoiceResult.data || []).map(function (invoice) {
        var job = (jobs[invoice.id] || [])[0] || {}, record = overrides[invoice.id] || {}, issued = materials[invoice.id] || [];
        var services = invoice.invoice_services || [], service = services.map(function (s) { return s.service_name + (s.service_detail ? ' – ' + s.service_detail : ''); }).join(', ');
        var jobCompleted = job.status === 'Completed' || job.status === 'Released';
        return { id: invoice.id, number: invoiceNumber(invoice.invoice_number), client: invoice.client_name, vehicle: job.vehicle || [invoice.vehicle_make, invoice.vehicle_year_model, invoice.plate_number].filter(Boolean).join(' · '), procedure: job.service_work || service, assigned: workers[job.worker_id] || invoice.assigned_admin, dateIn: invoice.invoice_date, target: job.target_completion || job.client_release_date || invoice.release_date, status: record.status || (jobCompleted ? 'Completed' : 'Received'), materials: issued.map(function (x) { return x.item_name + ' × ' + x.quantity; }).join(', ') };
      });
      render();
    } catch (error) { render('The Work Board could not load yet. ' + (error.message || 'Please refresh.')); }
    finally { loading = false; }
  }
  async function saveStatus(button) {
    var id = button.dataset.workSave, select = document.querySelector('[data-work-status="' + id + '"]'); if (!id || !select) return;
    button.disabled = true; button.textContent = 'Saving…';
    var session = await db.auth.getSession(), user = session.data && session.data.session && session.data.session.user;
    var result = await db.from('work_board_units').upsert({business_id:business(), branch_id:branch(), invoice_id:id, status:select.value, updated_by:user && user.id}, {onConflict:'business_id,branch_id,invoice_id'});
    if (result.error) alert('Work status could not be saved: ' + result.error.message); else await load();
    button.disabled = false; button.textContent = 'Save';
  }
  function start() {
    var config = window.BUSINESS_WEB_CENTER_SUPABASE || {};
    if (!window.supabase || !config.url || !config.publishableKey || !business() || !branch()) { setTimeout(start, 500); return; }
    db = window.businessSupabase || window.supabase.createClient(config.url, config.publishableKey); online = true; ensureUi();
    if (document.getElementById('workboard').classList.contains('active')) load();
  }
  document.addEventListener('click', function (event) { var save = event.target.closest('[data-work-save]'); if (save) { event.preventDefault(); saveStatus(save); } });
  document.addEventListener('bwc:branch-ready', function () { setTimeout(function () { ensureUi(); if (document.getElementById('workboard').classList.contains('active')) load(); }, 160); });
  document.addEventListener('bwc:invoices-loaded', function () { if (document.getElementById('workboard') && document.getElementById('workboard').classList.contains('active')) setTimeout(load, 100); });
  window.addEventListener('load', function () { setTimeout(start, 180); });
}());
