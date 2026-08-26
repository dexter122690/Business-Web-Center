/* Fixed-amount invoice discounts. The final invoice total is always the
   services/parts subtotal less this optional discount. */
(function(){
  function field(){return document.getElementById('discountAmount')}
  function number(value){return Math.max(0,Number(value)||0)}
  function subtotal(){var serviceLines=typeof services==='undefined'?[]:services,partLines=typeof parts==='undefined'?[]:parts;return serviceLines.reduce(function(sum,row){return sum+number(row.a)},0)+partLines.reduce(function(sum,row){return sum+number(row.a)},0)}
  function discount(){return Math.min(number(field()&&field().value),subtotal())}
  function setSummary(id,value){var item=document.getElementById(id);if(item&&window.P)item.textContent=window.P(value)}
  function update(){var gross=subtotal(),less=discount(),net=Math.max(0,gross-less),paid=number(document.getElementById('paid')&&document.getElementById('paid').value),status=document.getElementById('status');setSummary('total',net);setSummary('received',paid);setSummary('balance',Math.max(0,net-paid));if(status)status.value=net&&paid>=net?'Paid':paid?'Partially paid':'Pending';var note=document.getElementById('invoiceDiscountSummary');if(note)note.textContent=less>0?'Subtotal '+window.P(gross)+' − discount '+window.P(less)+' = final total '+window.P(net):'No discount applied.'}
  function install(){
    var paid=document.getElementById('paid');if(!paid||field())return;
    var label=document.createElement('label');label.innerHTML='Discount amount (PHP)<input id="discountAmount" type="number" min="0" step=".01" value="0">';paid.closest('label').insertAdjacentElement('beforebegin',label);
    var note=document.createElement('p');note.id='invoiceDiscountSummary';note.className='muted';note.style.margin='8px 0 0';var summary=document.querySelector('#invoices .summary');if(summary)summary.insertAdjacentElement('afterend',note);
    label.querySelector('input').addEventListener('input',update);
    var oldReset=window.resetInvoice;if(oldReset)window.resetInvoice=function(){oldReset();var input=field();if(input)input.value='0';update()};
    var oldEdit=window.editInvoice;if(oldEdit)window.editInvoice=function(id){oldEdit(id);var records=typeof inv==='undefined'?[]:inv,row=records.find(function(item){return String(item.id)===String(id)}),input=field();if(input)input.value=number(row&&row.discount);update()};
    window.total=function(){return Math.max(0,subtotal()-discount())};
    window.updateSummary=update;
    update();
  }
  install();
})();
