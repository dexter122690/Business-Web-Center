/* Shared Forms folder backed by Supabase Storage and business_forms metadata. */
(function () {
  var pageId = 'formsFolder', bucket = 'business-forms', rows = [], online = false;
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
  function db() { return window.getBusinessSupabaseClient && window.getBusinessSupabaseClient(); }
  function business() { return localStorage.getItem('bwc-active-business') || ''; }
  function branch() { return localStorage.getItem('bwc-active-branch') || ''; }
  function page() { return document.getElementById(pageId); }
  function catalog() { return rows.slice(); }
  function status(text, error) { var box = document.getElementById('formsFolderStatus'); if (box) { box.textContent = text; box.style.borderLeftColor = error ? '#b63d25' : ''; } }
  function ensurePage() {
    var main = document.querySelector('main'); if (!main) return null;
    var view = page(); if (view) return view;
    view = document.createElement('section'); view.id = pageId; view.className = 'view';
    view.innerHTML = '<div class="heading"><div><div class="k">FORMS FOLDER</div><h1>Forms</h1><p class="muted">Shared forms for this business and branch. Open a form, then print it manually.</p></div><label class="secondary" style="cursor:pointer">Upload form<input id="formsUpload" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" style="display:none"></label></div><div id="formsFolderStatus" class="notice">Loading shared forms...</div><div class="card" style="padding:0;overflow:auto"><div id="formsList"></div></div><div class="notice" style="margin-top:12px">Files uploaded here are shared with authorized users in this business branch.</div>';
    main.appendChild(view); return view;
  }
  function render() {
    var list = document.getElementById('formsList'); if (!list) return;
    var all = catalog();
    list.innerHTML = all.length ? '<table><thead><tr><th>Form name</th><th>Type</th><th>Uploaded</th><th>Action</th></tr></thead><tbody>' + all.map(function (item) { return '<tr><td><b>' + esc(item.name) + '</b></td><td>' + esc((item.mime_type || 'FILE').split('/').pop().toUpperCase()) + '</td><td>' + esc(new Date(item.created_at).toLocaleDateString()) + '</td><td class="actions"><button type="button" class="secondary" data-form-open="' + esc(item.id) + '">Open / print</button><button type="button" class="secondary" data-form-download="' + esc(item.id) + '">Download</button><button type="button" class="secondary" data-form-delete="' + esc(item.id) + '">Delete</button></td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">No shared forms uploaded for this branch yet.</div>';
  }
  async function load() {
    var client = db(); if (!client || !business() || !branch()) { online = false; status('Online workspace is still loading. Please try again.', true); render(); return; }
    var result = await client.from('business_forms').select('id,name,storage_path,mime_type,size_bytes,created_at').eq('business_id', business()).eq('branch_id', branch()).order('created_at', { ascending: false });
    if (result.error) { online = false; status('Forms could not load online. Apply migration 069_business_forms.sql, then refresh.', true); render(); return; }
    rows = result.data || []; online = true; status('Shared forms are ready.'); render();
  }
  async function urlFor(item, download) {
    if (item.public_path) return item.public_path;
    var client = db(); if (!client) throw new Error('The Supabase connection is not ready.');
    var result = await client.storage.from(bucket).createSignedUrl(item.storage_path, 300, download ? { download: item.name } : {});
    if (result.error) throw result.error; return result.data.signedUrl;
  }
  async function upload(file) {
    if (!online) { status('Upload unavailable until the shared workspace is ready.', true); return; }
    var client = db(), safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_'), path = business() + '/' + branch() + '/' + Date.now() + '-' + safeName;
    status('Uploading ' + file.name + '...');
    var stored = await client.storage.from(bucket).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (stored.error) throw stored.error;
    var session = await client.auth.getSession(), user = session.data && session.data.session && session.data.session.user;
    var inserted = await client.from('business_forms').insert({ business_id: business(), branch_id: branch(), name: file.name, storage_path: path, mime_type: file.type || 'application/octet-stream', size_bytes: file.size, uploaded_by: user && user.id }).select().single();
    if (inserted.error) { await client.storage.from(bucket).remove([path]); throw inserted.error; }
    status('Form uploaded and shared.'); await load();
  }
  async function remove(item) {
    if (!confirm('Delete ' + item.name + ' from this branch Forms folder?')) return;
    var client = db(), removed = await client.from('business_forms').delete().eq('id', item.id); if (removed.error) throw removed.error;
    await client.storage.from(bucket).remove([item.storage_path]); await load();
  }
  function openForms() { var view = ensurePage(); if (!view) return; document.querySelectorAll('.view').forEach(function (item) { item.classList.toggle('active', item === view); }); document.querySelectorAll('#nav button').forEach(function (button) { button.classList.toggle('active', button === document.getElementById('formsFolderTab')); }); localStorage.setItem('15m-last-tab', pageId); render(); load(); }
  function ensureTab() {
    var nav = document.getElementById('nav'); if (!nav || document.getElementById('formsFolderTab')) return;
    var button = document.createElement('button'); button.id = 'formsFolderTab'; button.type = 'button'; button.textContent = 'Forms'; button.onclick = openForms;
    var requests = document.getElementById('clientRequestsTab'); if (requests) requests.insertAdjacentElement('afterend', button); else nav.appendChild(button);
  }
  document.addEventListener('click', async function (event) {
    var open = event.target.closest('[data-form-open]'), download = event.target.closest('[data-form-download]'), del = event.target.closest('[data-form-delete]');
    try {
      if (open || download) { var item = catalog().find(function (row) { return String(row.id) === String((open || download).dataset[open ? 'formOpen' : 'formDownload']); }); if (!item) return; var url = await urlFor(item, !!download); window.open(url, '_blank', 'noopener'); return; }
      if (del) { var target = rows.find(function (row) { return String(row.id) === String(del.dataset.formDelete); }); if (target) await remove(target); }
    } catch (error) { status('Form action failed: ' + (error.message || 'Please try again.'), true); }
  });
  document.addEventListener('change', function (event) { if (event.target.id !== 'formsUpload' || !event.target.files.length) return; upload(event.target.files[0]).catch(function (error) { status('Upload failed: ' + (error.message || 'Please try again.'), true); }); event.target.value = ''; });
  document.addEventListener('bwc:business-ready', function () { if (page() && page().classList.contains('active')) load(); });
  document.addEventListener('bwc:branch-ready', function () { if (page() && page().classList.contains('active')) load(); });
  window.addEventListener('load', function () { ensurePage(); var tries = 0, timer = setInterval(function () { ensureTab(); if (document.getElementById('formsFolderTab') || tries++ > 30) clearInterval(timer); }, 250); });
})();
