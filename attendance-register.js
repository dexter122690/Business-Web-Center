/* Compact attendance register: current-period filters, search, summaries, and paging. */
(function () {
  var KEY = '15m-recovery-payroll';
  var VIEW_KEY = '15m-recovery-attendance-view';
  var PAGE_SIZE = 20;

  function payrollData() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (error) { return {}; } }
  function view() { try { return JSON.parse(sessionStorage.getItem(VIEW_KEY) || '{}'); } catch (error) { return {}; } }
  function saveView(value) { sessionStorage.setItem(VIEW_KEY, JSON.stringify(value)); }
  function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, function (character) { return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]; }); }
  function localToday() { var date = new Date(); return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); }
  function isLate(value) { return String(value || '').replace(/\s*(am|pm)$/i, '').replace(':', '') > '0800'; }

  function render() {
    var payroll = document.getElementById('payroll');
    if (!payroll || !payroll.querySelector('#prAttendanceEmployeeId')) return;
    var existing = document.getElementById('prAllAttendanceMasterlist');
    if (existing) existing.remove();

    var data = payrollData(), workers = data.workers || [], state = view();
    if (state.start === undefined) state.start = data.weekStart || '';
    if (state.end === undefined) state.end = data.weekEnd || '';
    if (state.page === undefined) state.page = 0;
    var workerById = function (id) { return workers.find(function (worker) { return String(worker.id) === String(id); }); };
    var workerName = function (id) { var worker = workerById(id); return worker ? (worker.name || 'Worker') : 'Unknown worker'; };
    var records = (data.attendance || []).slice().sort(function (a, b) { return (String(b.date) + String(b.timeIn)).localeCompare(String(a.date) + String(a.timeIn)); });
    var filtered = records.filter(function (record) {
      var text = String(state.search || '').toLowerCase();
      var matches = [workerName(record.workerId), record.workerId, record.date, record.timeIn, record.timeOut].join(' ').toLowerCase();
      return (!state.workerId || String(record.workerId) === String(state.workerId)) && (!state.start || String(record.date) >= state.start) && (!state.end || String(record.date) <= state.end) && (!text || matches.indexOf(text) > -1);
    });
    var today = localToday(), todayRows = records.filter(function (record) { return record.date === today; });
    var missingOut = todayRows.filter(function (record) { return !record.timeOut; }).length;
    var pendingOvertime = filtered.filter(function (record) { return Number(record.overtimeHours || 0) > 0 && !record.overtimeApproved; }).length;
    var lateRows = todayRows.filter(function (record) { return record.timeIn && isLate(record.timeIn); }).length;
    var maxPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
    state.page = Math.min(state.page, maxPage); saveView(state);
    var rows = filtered.slice(state.page * PAGE_SIZE, state.page * PAGE_SIZE + PAGE_SIZE);
    var box = document.createElement('div');
    box.id = 'prAllAttendanceMasterlist'; box.className = 'card'; box.style.marginTop = '18px';
    var employeeOptions = workers.map(function (worker) { return '<option value="' + escapeHtml(worker.id) + '" ' + (String(state.workerId) === String(worker.id) ? 'selected' : '') + '>' + escapeHtml((worker.name || 'Worker') + ' · ' + worker.id) + '</option>'; }).join('');
    var body = rows.length ? '<div style="overflow:auto"><table><thead><tr><th>Employee</th><th>Date</th><th>Time in</th><th>Time out</th><th>Regular hrs</th><th>Overtime hrs</th><th>Review</th><th>Photo proof</th></tr></thead><tbody>' + rows.map(function (record) {
      var review = Number(record.overtimeHours || 0) > 0 ? (record.overtimeApproved ? 'Approved' : 'Pending review') : 'Regular';
      return '<tr><td><b>' + escapeHtml(workerName(record.workerId)) + '</b><br><small>' + escapeHtml(record.workerId) + '</small></td><td>' + escapeHtml(record.date) + '</td><td>' + escapeHtml(record.timeIn || '—') + '</td><td>' + escapeHtml(record.timeOut || '—') + '</td><td>' + Number(record.regularHours || 0).toFixed(2) + '</td><td>' + Number(record.overtimeHours || 0).toFixed(2) + '</td><td>' + review + '</td><td>' + (record.photo ? 'Saved' : '—') + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<div class="empty">No attendance records match these filters.</div>';
    box.innerHTML = '<div class="k">Attendance register</div><h2>Current attendance records</h2><p class="muted">Showing the current payroll period by default. Search or filter without deleting any attendance data.</p>' +
      '<div class="grid" style="margin:14px 0"><div class="card"><div class="muted">Present today</div><div class="metric">' + todayRows.length + '</div></div><div class="card"><div class="muted">Missing time out</div><div class="metric">' + missingOut + '</div></div><div class="card"><div class="muted">Pending overtime review</div><div class="metric">' + pendingOvertime + '</div></div><div class="card"><div class="muted">Late arrivals today</div><div class="metric">' + lateRows + '</div></div></div>' +
      '<div class="formgrid"><label>Search employee or ID<input id="prAttendanceSearch" value="' + escapeHtml(state.search || '') + '" placeholder="Type a name or employee ID"></label><label>Employee<select id="prAttendanceFilterWorker"><option value="">All employees</option>' + employeeOptions + '</select></label><label>From<input id="prAttendanceFilterStart" type="date" value="' + escapeHtml(state.start || '') + '"></label><label>To<input id="prAttendanceFilterEnd" type="date" value="' + escapeHtml(state.end || '') + '"></label></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><button class="secondary" data-att-filter="apply">Apply filters</button><button class="secondary" data-att-filter="current">Current pay period</button><button class="secondary" data-att-filter="clear">Show all dates</button></div>' + body +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:14px"><span class="muted">' + (filtered.length ? 'Showing ' + (state.page * PAGE_SIZE + 1) + '–' + Math.min((state.page + 1) * PAGE_SIZE, filtered.length) + ' of ' + filtered.length : '0 records') + '</span><span><button class="secondary" data-att-page="prev" ' + (state.page === 0 ? 'disabled' : '') + '>Previous</button> <button class="secondary" data-att-page="next" ' + (state.page >= maxPage ? 'disabled' : '') + '>Next</button></span></div><p class="muted" style="margin-top:12px">Use Worker Records when you need one employee’s complete history.</p>';
    var content = payroll.querySelector('#prContent');
    content.insertBefore(box, content.children[1] || null);
  }

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-pr-tab="attendance"]')) { setTimeout(render, 160); return; }
    var action = event.target.closest('[data-att-filter]'), pager = event.target.closest('[data-att-page]'), state = view();
    if (action) {
      if (action.dataset.attFilter === 'apply') { state.search = document.getElementById('prAttendanceSearch').value.trim(); state.workerId = document.getElementById('prAttendanceFilterWorker').value; state.start = document.getElementById('prAttendanceFilterStart').value; state.end = document.getElementById('prAttendanceFilterEnd').value; state.page = 0; }
      else if (action.dataset.attFilter === 'current') { var data = payrollData(); state.search = ''; state.workerId = ''; state.start = data.weekStart || ''; state.end = data.weekEnd || ''; state.page = 0; }
      else { state.search = ''; state.workerId = ''; state.start = ''; state.end = ''; state.page = 0; }
      saveView(state); render();
    }
    if (pager) { state.page = Math.max(0, Number(state.page || 0) + (pager.dataset.attPage === 'next' ? 1 : -1)); saveView(state); render(); }
  });
  window.addEventListener('load', function () { setTimeout(render, 260); });
}());
