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
  function showError(event) { var picker = mount(); if (!picker) return; picker.innerHTML = '<option>Access unavailable</option>'; picker.disabled = true; console.warn('BWC workspace context:', event.detail && event.detail.message); }
  style(); mount();
  document.addEventListener('bwc:context-ready', function (event) { render(event.detail); });
  document.addEventListener('bwc:context-error', showError);
  window.addEventListener('load', function () { if (window.BWCContext && window.BWCContext.get()) render(window.BWCContext.get()); });
}());
