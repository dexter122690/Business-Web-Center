/*
  Shared, database-validated workspace context.
  Browser storage remembers a previous choice only; it never grants access.
*/
(function () {
  var state = { status: 'checking', version: 0, error: null, data: null };
  var listeners = [];
  function emit(name, detail) { document.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); }
  function bounded(promise, milliseconds) {
    return Promise.race([promise, new Promise(function (resolve, reject) { setTimeout(function () { reject(new Error('Timed out')); }, milliseconds); })]);
  }
  function publish(next, error) {
    state.status = next ? 'ready' : 'error'; state.data = next || null; state.error = error || null; state.version += 1;
    window.BWCContext = api;
    if (next) {
      /* Convenience only. Every value was validated against the signed-in user. */
      localStorage.setItem('bwc-active-business', next.business.id);
      localStorage.setItem('bwc-active-business-name', next.business.name || '');
      localStorage.setItem('bwc-active-branch', next.branch.id);
      emit('bwc:context-ready', next);
      emit('bwc:business-ready', next);
      emit('bwc:branch-ready', { branchId: next.branch.id, context: next });
    } else {
      var main = document.querySelector('main');
      if (main && !document.getElementById('bwcContextError')) {
        var notice = document.createElement('div'); notice.id = 'bwcContextError'; notice.className = 'notice';
        notice.textContent = 'Workspace access could not be loaded. ' + (error || 'Please sign in again or ask the business owner to check your access.');
        main.insertBefore(notice, main.firstChild);
      }
      emit('bwc:context-error', { message: error || 'Your workspace could not be loaded.' });
    }
    listeners.splice(0).forEach(function (listener) { listener(state); });
  }
  function wait() { return new Promise(function (resolve, reject) { if (state.status === 'ready') return resolve(state.data); if (state.status === 'error') return reject(new Error(state.error)); listeners.push(function (next) { next.status === 'ready' ? resolve(next.data) : reject(new Error(next.error)); }); }); }
  function activeBusiness(rows) {
    var saved = localStorage.getItem('bwc-active-business');
    var selected = rows.filter(function (row) { return row.id === saved; })[0];
    if (selected) return selected;
    /* A new staff account may also own an empty sign-up workspace. Prefer the
       one assigned through Team Access when it is unambiguous. */
    var assigned = rows.filter(function (row) { return ['admin', 'staff'].includes(row.membership.role); });
    return assigned.length === 1 ? assigned[0] : rows[0];
  }
  async function resolve() {
    var config = window.BUSINESS_WEB_CENTER_SUPABASE || {};
    /* index.html loads the Supabase library dynamically. Wait for it rather
       than declaring an empty workspace while the library is still arriving. */
    if (!window.supabase || !config.url || !config.publishableKey) { setTimeout(resolve, 150); return; }
    var db = window.businessSupabase || window.supabase.createClient(config.url, config.publishableKey);
    window.businessSupabase = db;
    var sessionResult = await db.auth.getSession(), user = sessionResult.data && sessionResult.data.session && sessionResult.data.session.user;
    if (!user) return publish(null, 'Please sign in to continue.');
    /* Repairs a delayed invitation/profile link when the database function is available. */
    /* A delayed background invitation refresh must never hold the whole branch
       picker on “Loading…”. The database membership remains the authority. */
    try { await bounded(db.rpc('refresh_my_team_access'), 3000); } catch (ignore) {}
    var profile = await db.from('profiles').select('platform_role').eq('id', user.id).maybeSingle();
    if (profile.error) return publish(null, 'Your account profile could not be checked.');
    if (profile.data && profile.data.platform_role === 'platform_admin') return publish({ user: user, platformAdmin: true, business: null, branch: null, role: 'platform_admin', permissions: {} });
    var memberships = await db.from('business_memberships').select('business_id,role,permissions,status').eq('user_id', user.id).eq('status', 'active');
    if (memberships.error) return publish(null, 'Your business access could not be checked.');
    if (!memberships.data || !memberships.data.length) return publish(null, 'This account has no active business access.');
    var ids = memberships.data.map(function (row) { return row.business_id; });
    var businesses = await db.from('businesses').select('id,name,status').in('id', ids);
    if (businesses.error) return publish(null, 'Your business workspace could not be loaded.');
    var membershipById = {}; memberships.data.forEach(function (row) { membershipById[row.business_id] = row; });
    var choices = (businesses.data || []).filter(function (row) { return row.status === 'active' && membershipById[row.id]; }).map(function (row) { row.membership = membershipById[row.id]; return row; });
    if (!choices.length) return publish(null, 'This account has no active business workspace.');
    var business = activeBusiness(choices), membership = business.membership;
    var branchResult = await db.from('branches').select('id,name,address,contact_number,email').eq('business_id', business.id).eq('is_active', true).order('created_at');
    if (branchResult.error) return publish(null, 'Your branch list could not be loaded.');
    var branches = branchResult.data || [];
    if (membership.role !== 'owner') {
      var access = await db.from('business_member_branch_access').select('branch_id').eq('business_id', business.id).eq('user_id', user.id);
      if (access.error) return publish(null, 'Your branch access could not be checked.');
      var allowed = {}; (access.data || []).forEach(function (row) { allowed[row.branch_id] = true; });
      branches = branches.filter(function (row) { return allowed[row.id]; });
    }
    if (!branches.length) return publish(null, 'This account has no active branch access. Ask the business owner to assign a branch.');
    var savedBranch = localStorage.getItem('bwc-active-branch');
    var branch = branches.filter(function (row) { return row.id === savedBranch; })[0] || branches[0];
    publish({ user: user, business: business, branch: branch, branches: branches, role: membership.role, permissions: membership.permissions || {}, platformAdmin: false });
  }
  var api = { get: function () { return state.data; }, whenReady: wait, refresh: resolve, status: function () { return state.status; } };
  window.BWCContext = api;
  window.addEventListener('load', function () { setTimeout(resolve, 0); });
  window.addEventListener('pageshow', function () { if (state.status !== 'ready') resolve(); });
  setTimeout(function () { if (state.status === 'checking') resolve(); }, 4000);
}());
