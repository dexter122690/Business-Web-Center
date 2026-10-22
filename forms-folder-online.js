/* Simple shared Forms folder. Files are opened and printed manually; uploaded
   files are kept on this browser so the folder is useful offline too. */
(function () {
  var key = '15m-forms-folder';
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
  function read() { try { var rows = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(rows) ? rows : []; } catch (e) { return []; } }
  function write(rows) { localStorage.setItem(key, JSON.stringify(rows)); }
  function page() { return document.getElementById('formsFolder'); }
  function ensurePage() {
    var main = document.querySelector('main'); if (!main) return null;
    var view = page(); if (view) return view;
    view = document.createElement('section'); view.id = 'formsFolder'; view.className = 'view';
    view.innerHTML = '<div class="heading"><div><div class="k">FORMS FOLDER</div><h1>Forms</h1><p class="muted">Keep blank forms here, open them when needed, and print them manually.</p></div><label class="secondary" style="cursor:pointer">Upload form<input id="formsUpload" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" style="display:none"></label></div><div class="card" style="padding:0;overflow:auto"><div id="formsList"></div></div><div class="notice" style="margin-top:12px">Uploaded files are stored on this browser. The standard PMS checklist is included with the website.</div>';
    main.appendChild(view); return view;
  }
  function items() { return [{ name: '15M PMS Checklist', file: 'forms/15M_PMS_Checklist_Control_No.pdf', kind: 'PDF', builtin: true }].concat(read()); }
  function render() {
    var view = ensurePage(), list = document.getElementById('formsList'); if (!view || !list) return;
    var rows = items(); list.innerHTML = rows.length ? '<table><thead><tr><th>Form name</th><th>Type</th><th>Action</th></tr></thead><tbody>' + rows.map(function (item, index) { var href = item.data || item.file; return '<tr><td><b>' + esc(item.name) + '</b></td><td>' + esc(item.kind || 'File') + '</td><td class="actions"><button type="button" class="secondary" data-form-print="' + index + '">Print</button><a class="secondary" href="' + esc(href) + '" target="_blank" rel="noopener">Open</a><a class="secondary" href="' + esc(href) + '" download="' + esc(item.name) + '">Download</a>' + (item.builtin ? '' : '<button type="button" class="secondary" data-form-remove="' + index + '">Remove</button>') + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">No forms uploaded yet.</div>';
  }
  function openForms() { var view = ensurePage(); if (!view) return; document.querySelectorAll('.view').forEach(function (item) { item.classList.toggle('active', item === view); }); document.querySelectorAll('#nav button').forEach(function (button) { button.classList.toggle('active', button === document.getElementById('formsFolderTab')); }); localStorage.setItem('15m-last-tab', 'formsFolder'); render(); }
  function ensureTab() {
    var nav = document.getElementById('nav'); if (!nav || document.getElementById('formsFolderTab')) return;
    var button = document.createElement('button'); button.id = 'formsFolderTab'; button.type = 'button'; button.textContent = 'Forms'; button.onclick = openForms;
    var requests = document.getElementById('clientRequestsTab'); if (requests) requests.insertAdjacentElement('afterend', button); else nav.appendChild(button);
  }
  document.addEventListener('click', function (event) { var print = event.target.closest('[data-form-print]'); if (print) { var item = items()[Number(print.dataset.formPrint)], href = item && (item.data || item.file); if (!href) return; var win = window.open('', '_blank'); if (!win) { alert('Allow pop-ups to print the form.'); return; } win.document.write('<!doctype html><title>' + esc(item.name) + '</title><style>html,body,iframe{width:100%;height:100%;margin:0;border:0}</style><iframe src="' + esc(href) + '"></iframe>'); win.document.close(); win.focus(); return; } var remove = event.target.closest('[data-form-remove]'); if (!remove) return; var uploaded = read(), index = Number(remove.dataset.formRemove) - 1; if (index >= 0) { uploaded.splice(index, 1); write(uploaded); render(); } });
  document.addEventListener('change', function (event) { if (event.target.id !== 'formsUpload' || !event.target.files.length) return; var file = event.target.files[0], reader = new FileReader(); reader.onload = function () { var uploaded = read(); uploaded.push({ name: file.name, kind: (file.name.split('.').pop() || 'FILE').toUpperCase(), data: reader.result }); write(uploaded); render(); event.target.value = ''; }; reader.readAsDataURL(file); });
  window.addEventListener('load', function () { ensurePage(); var tries = 0, timer = setInterval(function () { ensureTab(); if (document.getElementById('formsFolderTab') || tries++ > 30) clearInterval(timer); }, 250); });
})();
