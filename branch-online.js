/* Branch picker backed by the already-authorized shared workspace context. */
(function () {
  var activeKey = 'bwc-active-branch';
  if (new URLSearchParams(location.search).has('branch')) history.replaceState(null, '', location.pathname + location.hash);
  function esc(value) { return String(value || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function name(value) { return value === 'Main workspace' ? 'MAIN' : value; }
  function mount() {
    var target = document.querySelector('header .branch'), header = document.querySelector('header');
    if (!target && header) { target = document.createElement('div'); target.className = 'branch'; header.appendChild(target); }
    if (!target) return null;
    target.innerHTML = '<b>BRANCH</b><select id="onlineBranchPicker" aria-label="Choose branch" disabled><option>Loading…</option></select>';
    return target.querySelector('select');
  }
  function style() {
    if (document.getElementById('onlineBranchPickerStyle')) return;
    var tag = document.createElement('style'); tag.id = 'onlineBranchPickerStyle';
    tag.textContent = 'header .branch{margin-left:auto!important;display:flex!important;align-items:center;gap:8px;font-size:11px;white-space:nowrap}header .branch select{display:inline-block!important;width:auto!important;min-width:106px;max-width:180px;background:#201b19!important;color:#fff!important;border:1px solid #8f6b5d!important;border-radius:6px!important;padding:6px 26px 6px 9px!important;font-weight:bold!important;cursor:pointer}@media(max-width:720px){header .branch{display:flex!important;order:3;margin-left:auto!important}header .branch b{display:none}header .branch select{min-width:82px;max-width:118px;font-size:10px;padding:6px 20px 6px 7px!important}}'; document.head.appendChild(tag);
  }
  function render(context) {
    if (!context || context.platformAdmin) return;
    var picker = mount(); if (!picker) return;
    picker.innerHTML = context.branches.map(function (branch) { return '<option value="' + esc(branch.id) + '"' + (branch.id === context.branch.id ? ' selected' : '') + '>' + esc(name(branch.name)) + '</option>'; }).join('');
    picker.disabled = context.branches.length < 2;
    picker.onchange = function () { localStorage.setItem(activeKey, picker.value); location.reload(); };
  }
  /* The shared workspace context is the normal source of truth.  In a few
     browser sessions its optional profile refresh can be delayed even though
     the signed-in account has already loaded invoices.  Do not strand that
     valid account on “Loading…”: re-read only the branches permitted by the
     database security rules. */
  async function recoverDelayedContext() {
    var picker = document.getElementById('onlineBranchPicker');
    if (!picker || picker.options[0].text !== 'Loading…') return;
    var db = window.businessSupabase;
    if (!db) return setTimeout(recoverDelayedContext, 1000);
    try {
      var session = await db.auth.getSession();
      var user = session.data && session.data.session && session.data.session.user;
      var businessId = localStorage.getItem('bwc-active-business');
      if (!user || !businessId) return;
      var membership = await db.from('business_memberships').select('role').eq('business_id', businessId).eq('user_id', user.id).eq('status', 'active').maybeSingle();
      if (membership.error || !membership.data) return;
      var result = await db.from('branches').select('id,name,address,contact_number,email').eq('business_id', businessId).eq('is_active', true).order('created_at');
      if (result.error || !result.data || !result.data.length) return;
      var branches = result.data;
      if (membership.data.role !== 'owner') {
        var access = await db.from('business_member_branch_access').select('branch_id').eq('business_id', businessId).eq('user_id', user.id);
        if (access.error) return;
        var allowed = {}; (access.data || []).forEach(function (row) { allowed[row.branch_id] = true; });
        branches = branches.filter(function (branch) { return allowed[branch.id]; });
      }
      if (!branches.length) return;
      var saved = localStorage.getItem(activeKey);
      var branch = branches.filter(function (item) { return item.id === saved; })[0] || branches[0];
      render({ branches: branches, branch: branch });
    } catch (error) { console.warn('Branch picker recovery was unavailable:', error); }
  }
  function showError(event) { var picker = mount(); if (!picker) return; picker.innerHTML = '<option>Access unavailable</option>'; picker.disabled = true; console.warn('BWC workspace context:', event.detail && event.detail.message); }
  style(); mount();
  document.addEventListener('bwc:context-ready', function (event) { render(event.detail); });
  document.addEventListener('bwc:context-error', showError);
  window.addEventListener('load', function () { if (window.BWCContext && window.BWCContext.get()) render(window.BWCContext.get()); });
  setTimeout(recoverDelayedContext, 3500);
}());
