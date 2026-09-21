/* Quotation-wide discount controls. Discounts stay in quotation details so
   existing saved quotations and the shared online record remain compatible. */
(function () {
  var key = '15m-replica-quotes', lastSubtotal = 0;

  function read() { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; } }
  function money(value) { return 'PHP ' + Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function value(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function number(value) { return Math.max(0, Number(value) || 0); }
  function controls() { return { type: value('qtDiscountType') || 'none', value: number(value('qtDiscountValue')) }; }
  function visibleSubtotal() {
    var rows = Array.prototype.slice.call(document.querySelectorAll('#qtLines tbody tr'));
    if (!rows.length) return lastSubtotal;
    return rows.reduce(function (sum, row) {
      var cell = row.children[4], amount = String(cell ? cell.textContent : '').replace(/[^0-9.\-]/g, '');
      return sum + (Number(amount) || 0);
    }, 0);
  }
  function calculation(subtotal) {
    var selected = controls(), amount = 0;
    if (selected.type === 'percent') amount = subtotal * Math.min(selected.value, 100) / 100;
    if (selected.type === 'amount') amount = selected.value;
    amount = Math.min(Math.max(0, amount), subtotal);
    return { type: selected.type, value: selected.value, subtotal: subtotal, amount: amount, total: subtotal - amount };
  }
  function selectedQuote() {
    var all = read(), client = value('qtClient'), date = value('qtDate'), vehicle = value('qtVehicle'), plate = value('qtPlate');
    return all.find(function (quote) { return quote.client === client && quote.date === date && quote.vehicle === vehicle && quote.plate === plate; }) || null;
  }
  function mount() {
    var lines = document.getElementById('qtLines'), lineCard = lines && lines.closest('.card');
    if (!lineCard || document.getElementById('quotationDiscountCard')) return;
    var card = document.createElement('div');
    card.id = 'quotationDiscountCard'; card.className = 'card'; card.style.marginTop = '14px';
    card.innerHTML = '<div class="k">Quotation discount</div><h2>Discount</h2><p class="muted">Apply one discount to the whole quotation. It reduces the estimate only; it does not create a sale or payment.</p><div class="formgrid"><label>Discount type<select id="qtDiscountType"><option value="none">No discount</option><option value="percent">Percentage (%)</option><option value="amount">Exact amount (PHP)</option></select></label><label>Discount value<input id="qtDiscountValue" type="number" min="0" step="0.01" value="0" disabled></label></div><div class="notice" id="qtDiscountSummary" style="margin-top:12px"></div>';
    lineCard.insertAdjacentElement('afterend', card);
    var quote = selectedQuote(), type = quote && quote.discountType || 'none', discountValue = quote && Number(quote.discountValue || 0) || 0;
    document.getElementById('qtDiscountType').value = type;
    document.getElementById('qtDiscountValue').value = discountValue || 0;
    refresh();
  }
  function refresh() {
    var type = document.getElementById('qtDiscountType'), input = document.getElementById('qtDiscountValue'), summary = document.getElementById('qtDiscountSummary');
    if (!type || !input || !summary) return;
    input.disabled = type.value === 'none';
    input.placeholder = type.value === 'percent' ? 'e.g., 10' : 'e.g., 500';
    lastSubtotal = visibleSubtotal();
    var result = calculation(lastSubtotal), label = result.type === 'percent' ? result.value + '%' : money(result.value);
    summary.innerHTML = result.type === 'none'
      ? '<b>No discount applied.</b> Subtotal and quotation total are the same: <b>' + money(result.subtotal) + '</b>.'
      : 'Subtotal: <b>' + money(result.subtotal) + '</b> &nbsp; · &nbsp; Discount (' + label + '): <b>−' + money(result.amount) + '</b> &nbsp; · &nbsp; Final quotation total: <b>' + money(result.total) + '</b>.';
    var total = document.getElementById('qtTotal'); if (total) total.textContent = money(result.total);
  }
  function applyQuoteDiscount(id) {
    var quote = read().find(function (item) { return item.id === id; });
    if (!quote) return;
    mount();
    var type = document.getElementById('qtDiscountType'), input = document.getElementById('qtDiscountValue');
    if (type) type.value = quote.discountType || 'none';
    if (input) input.value = Number(quote.discountValue || 0);
    refresh();
  }
  function discountPrint(result) {
    if (result.type === 'none') return '';
    var label = result.type === 'percent' ? result.value + '%' : 'exact amount';
    return '<div class="discount-summary" style="text-align:right;margin-top:10px;line-height:1.55"><div>Subtotal: ' + money(result.subtotal) + '</div><div>Discount (' + label + '): −' + money(result.amount) + '</div></div>';
  }
  function install() {
    window.BWCQuotationDiscountRender = function (subtotal) { lastSubtotal = number(subtotal); refresh(); };
    window.BWCQuotationDiscount = function (quote, subtotal) {
      lastSubtotal = number(subtotal); var result = calculation(lastSubtotal);
      quote.subtotal = result.subtotal; quote.discountType = result.type; quote.discountValue = result.value; quote.discountAmount = result.amount; quote.total = result.total;
      return quote;
    };
    document.addEventListener('input', function (event) { if (event.target && event.target.id === 'qtDiscountValue') refresh(); });
    document.addEventListener('change', function (event) { if (event.target && (event.target.id === 'qtDiscountType' || event.target.id === 'qtDiscountValue')) refresh(); });
    document.addEventListener('click', function (event) {
      var edit = event.target.closest('[data-qt-edit]');
      if (edit) setTimeout(function () { applyQuoteDiscount(edit.dataset.qtEdit); }, 60);
      if (event.target.closest('[data-t="quotes"], [data-qt="new"]')) setTimeout(function () { mount(); refresh(); }, 60);
    }, true);
    var originalPrint = window.printQuotation;
    if (originalPrint) {
      window.printQuotation = function (mode) {
        var result = calculation(lastSubtotal), popup = originalPrint.call(this, mode);
        if (popup && result.type !== 'none') {
          var total = popup.document.querySelector('.total');
          if (total) total.insertAdjacentHTML('beforebegin', discountPrint(result));
        }
        return popup;
      };
    }
    mount(); refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(install, 80); });
  else setTimeout(install, 80);
}());
