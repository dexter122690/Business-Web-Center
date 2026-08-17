/* Adds safe multi-branch access on top of Team Access.
   Each branch keeps its own permission row and business data. */
(function () {
  'use strict';

  function client() {
    var config = window.BUSINESS_WEB_CENTER_SUPABASE || {};
    if (!window.supabase || !config.url || !config.publishableKey) return null;
    return window.businessSupabase || window.supabase.createClient(config.url, config.publishableKey);
  }

  function activeBusinessId() {
    return localStorage.getItem('bwc-active-business') || '';
  }

  function message(text) {
    var node = document.getElementById('teamAccessMessage');
    if (node) node.textContent = text;
  }

  function refreshModal() {
    var modal = document.getElementById('teamAccessModal');
    if (!modal) return;
    modal.remove();
    setTimeout(function () {
      var button = document.getElementById('teamAccessMenuButton');
      if (button) button.click();
    }, 250);
  }

  function permissions(form) {
    var value = {};
    form.querySelectorAll('[data-permission]').forEach(function (field) {
      value[field.dataset.permission] = field.value;
    });
    return value;
  }

  async function sessionContext() {
    var db = client();
    if (!db) throw new Error('Online access is still loading. Please try again in a moment.');
    var session = await db.auth.getSession();
    var businessId = activeBusinessId();
    if (!session.data.session || !businessId) throw new Error('Please sign in and choose a branch again.');
    return { db: db, businessId: businessId, user: session.data.session.user };
  }

  async function branchesFor(ctx) {
    var result = await ctx.db.from('branches').select('id,name')
      .eq('business_id', ctx.businessId).eq('is_active', true).order('created_at');
    if (result.error) throw result.error;
    return result.data || [];
  }

  async function syncRealAccess(ctx, email, role, perms) {
    var profile = await ctx.db.from('profiles').select('id').eq('email', email).maybeSingle();
    if (profile.error) throw profile.error;
    if (!profile.data) return;

    var assignments = await ctx.db.from('business_team_invites')
      .select('branch_id,role,permissions,status')
      .eq('business_id', ctx.businessId).eq('email', email)
      .in('status', ['approved', 'accepted']);
    if (assignments.error) throw assignments.error;

    var rows = assignments.data || [];
    if (!rows.length) {
      await ctx.db.from('business_memberships').update({ status: 'inactive' })
        .eq('business_id', ctx.businessId).eq('user_id', profile.data.id);
      await ctx.db.from('business_member_branch_access').delete()
        .eq('business_id', ctx.businessId).eq('user_id', profile.data.id);
      return;
    }

    var primary = rows[0];
    var membership = await ctx.db.from('business_memberships').upsert({
      business_id: ctx.businessId,
      user_id: profile.data.id,
      role: role || primary.role || 'staff',
      status: 'active',
      permissions: perms || primary.permissions || {}
    }, { onConflict: 'business_id,user_id' });
    if (membership.error) throw membership.error;

    var clear = await ctx.db.from('business_member_branch_access').delete()
      .eq('business_id', ctx.businessId).eq('user_id', profile.data.id);
    if (clear.error) throw clear.error;

    var seen = {};
    var accessRows = rows.filter(function (row) {
      if (!row.branch_id || seen[row.branch_id]) return false;
      seen[row.branch_id] = true;
      return true;
    }).map(function (row) {
      return {
        business_id: ctx.businessId,
        user_id: profile.data.id,
        branch_id: row.branch_id
      };
    });
    if (accessRows.length) {
      var grant = await ctx.db.from('business_member_branch_access').upsert(accessRows, {
        onConflict: 'business_id,user_id,branch_id'
      });
      if (grant.error) throw grant.error;
    }
  }

  async function saveInvitation(form) {
    try {
      var ctx = await sessionContext();
      var email = (document.getElementById('teamInviteEmail').value || '').trim().toLowerCase();
      var name = (document.getElementById('teamInviteName').value || '').trim();
      var branchChoice = document.getElementById('teamInviteBranch').value;
      if (!name || !email) throw new Error('Enter the team member name and email address.');

      var branches = await branchesFor(ctx);
      var targetBranches = branchChoice === '__all__'
        ? branches.map(function (branch) { return branch.id; })
        : [branchChoice];
      if (!targetBranches.length || targetBranches.some(function (id) { return !id; })) {
        throw new Error('Choose at least one branch.');
      }

      message('Saving branch access...');
      var existing = await ctx.db.from('business_team_invites')
        .select('branch_id,status')
        .eq('business_id', ctx.businessId).eq('email', email);
      if (existing.error) throw existing.error;
      var statusByBranch = {};
      (existing.data || []).forEach(function (row) { statusByBranch[row.branch_id] = row.status; });
      var role = document.getElementById('teamInviteRole').value;
      var perms = permissions(form);
      var payload = targetBranches.map(function (branchId) {
        var previous = statusByBranch[branchId];
        return {
          business_id: ctx.businessId,
          email: email,
          full_name: name,
          branch_id: branchId,
          role: role,
          permissions: perms,
          status: previous === 'approved' || previous === 'accepted' ? previous : 'pending',
          invited_by: ctx.user.id,
          email_delivery_status: 'not_sent',
          email_delivery_error: null
        };
      });
      var saved = await ctx.db.from('business_team_invites').upsert(payload, {
        onConflict: 'business_id,email,branch_id'
      }).select('id,status');
      if (saved.error) throw saved.error;

      if (saved.data.some(function (row) { return row.status === 'approved' || row.status === 'accepted'; })) {
        await syncRealAccess(ctx, email, role, perms);
      }
      form.reset();
      message('Access saved for ' + targetBranches.length + ' branch' + (targetBranches.length === 1 ? '' : 'es') + '. Sending one sign-in email...');
      var emailResult = await ctx.db.functions.invoke('send-team-invite', { body: { inviteId: saved.data[0].id } });
      if (emailResult.error) {
        message('Access was saved, but the email could not be sent. You can use Request again email below.');
      } else {
        message('Access saved for ' + targetBranches.length + ' branch' + (targetBranches.length === 1 ? '' : 'es') + ' and the sign-in email was requested.');
      }
      refreshModal();
    } catch (error) {
      message(error.message || 'The team access could not be saved.');
    }
  }

  async function approveEveryBranch(id) {
    try {
      var ctx = await sessionContext();
      var item = await ctx.db.from('business_team_invites').select('*').eq('id', id).maybeSingle();
      if (item.error) throw item.error;
      if (!item.data) throw new Error('This invitation was not found.');
      message('Approving access...');
      var updated = await ctx.db.from('business_team_invites').update({ status: 'approved' })
        .eq('business_id', ctx.businessId).eq('email', item.data.email)
        .in('status', ['pending', 'inactive']);
      if (updated.error) throw updated.error;
      await syncRealAccess(ctx, item.data.email, item.data.role, item.data.permissions);
      message('Approved. This person can now use every branch assigned to them.');
      refreshModal();
    } catch (error) {
      message(error.message || 'The team member could not be approved.');
    }
  }

  async function suspendEveryBranch(id) {
    if (!confirm('Suspend this person from every branch assigned to them?')) return;
    try {
      var ctx = await sessionContext();
      var item = await ctx.db.from('business_team_invites').select('*').eq('id', id).maybeSingle();
      if (item.error) throw item.error;
      if (!item.data) throw new Error('This team member was not found.');
      var updated = await ctx.db.from('business_team_invites').update({ status: 'inactive' })
        .eq('business_id', ctx.businessId).eq('email', item.data.email)
        .in('status', ['approved', 'accepted']);
      if (updated.error) throw updated.error;
      await syncRealAccess(ctx, item.data.email, item.data.role, item.data.permissions);
      refreshModal();
    } catch (error) {
      message(error.message || 'The team member could not be suspended.');
    }
  }

  async function deleteOneBranch(id) {
    if (!confirm('Remove this person from this branch only? Their access to other assigned branches will remain.')) return;
    try {
      var ctx = await sessionContext();
      var item = await ctx.db.from('business_team_invites').select('*').eq('id', id).maybeSingle();
      if (item.error) throw item.error;
      if (!item.data) throw new Error('This team member was not found.');
      var deleted = await ctx.db.from('business_team_invites').delete().eq('id', id);
      if (deleted.error) throw deleted.error;
      await syncRealAccess(ctx, item.data.email, item.data.role, item.data.permissions);
      refreshModal();
    } catch (error) {
      message(error.message || 'The branch access could not be removed.');
    }
  }

  function decorate() {
    var select = document.getElementById('teamInviteBranch');
    if (!select || select.dataset.multiBranchReady) return;
    var all = document.createElement('option');
    all.value = '__all__';
    all.textContent = 'Both branches (MAIN + STO. TOMAS)';
    // Keep the currently selected branch as the safe default. The owner must
    // deliberately choose this option when granting access to every branch.
    select.appendChild(all);
    select.dataset.multiBranchReady = 'yes';
    var label = select.closest('label');
    if (label && label.firstChild && label.firstChild.nodeType === Node.TEXT_NODE) {
      label.firstChild.nodeValue = 'Branch access (choose one or both)';
    }
    if (label) {
      var help = document.createElement('small');
      help.textContent = 'Choose “Both branches” to make this one staff account an admin of MAIN and STO. TOMAS.';
      help.style.display = 'block';
      help.style.marginTop = '4px';
      label.appendChild(help);
    }
    var description = document.querySelector('#teamAccessModal .heading p.muted');
    if (description) description.textContent = 'Invite a person to one branch or all current branches. Their records remain separated by branch.';
  }

  document.addEventListener('submit', function (event) {
    if (!event.target || event.target.id !== 'teamInviteForm') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    saveInvitation(event.target);
  }, true);

  document.addEventListener('click', function (event) {
    var approve = event.target.closest('[data-team-approve]');
    var suspend = event.target.closest('[data-team-suspend]');
    var remove = event.target.closest('[data-team-delete]');
    if (approve) {
      event.preventDefault();
      event.stopImmediatePropagation();
      approveEveryBranch(approve.dataset.teamApprove);
    } else if (suspend) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suspendEveryBranch(suspend.dataset.teamSuspend);
    } else if (remove) {
      event.preventDefault();
      event.stopImmediatePropagation();
      deleteOneBranch(remove.dataset.teamDelete);
    }
  }, true);

  new MutationObserver(decorate).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', decorate);
  decorate();
}());
