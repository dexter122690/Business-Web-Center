/* 15M legacy payroll retirement only. Server enforcement: migration 076.
   Loaded before legacy handlers; never deletes or rewrites browser/shared records. */
(function () {
  'use strict';
  var BUSINESS = 'ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875';
  var CLASS = 'bwc-legacy-payroll-paused';
  var MESSAGE = 'The old payroll is paused. Existing employee and job records are preserved while the new payroll is prepared.';
  function paused() {
    try { return localStorage.getItem('bwc-active-business') === BUSINESS; }
    catch (error) { return false; }
  }
  window.bwcLegacyPayrollPaused = paused;
  var style = document.createElement('style');
  style.textContent = 'html.' + CLASS + ' #payroll,html.' + CLASS + ' [data-t="payroll"],html.' + CLASS + ' [data-restore-tab="payroll"]{display:none!important}';
  document.head.appendChild(style);
  function isClock() { return /\/attendance\.html$/.test(window.location.pathname); }
  function apply() {
    var active = paused();
    document.documentElement.classList.toggle(CLASS, active);
    var section = document.getElementById('payroll');
    if (section) {
      section.inert = active;
      if (active && section.classList.contains('active')) {
        var dashboard = document.querySelector('[data-restore-tab="dashboard"],[data-t="dashboard"]');
        if (dashboard) dashboard.click();
      }
    }
    if (active && isClock()) {
      var status = document.getElementById('status');
      if (status) status.textContent = MESSAGE;
      var main = document.querySelector('main');
      if (main) main.inert = true;
    }
  }
  function block(event) {
    if (!paused()) return;
    var target = event.target;
    if (!target || !target.closest) return;
    var payroll = target.closest('#payroll,[data-t="payroll"],[data-restore-tab="payroll"],[data-pr],[data-pr-issued],[data-pr-issue-payslip],[data-pr-payment],[data-pr-edit],[data-worker-edit-save]');
    var clock = isClock() && target.closest('#openCamera,#capture');
    if (!payroll && !clock) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'click') window.alert(MESSAGE);
  }
  ['click','submit','change'].forEach(function (name) { window.addEventListener(name, block, true); });
  document.addEventListener('DOMContentLoaded', apply);
  ['bwc:business-ready','bwc:branch-ready'].forEach(function (name) {
    document.addEventListener(name, apply);
    window.addEventListener(name, apply);
  });
  window.addEventListener('storage', function (event) { if (event.key === 'bwc-active-business') apply(); });
  apply();
}());
