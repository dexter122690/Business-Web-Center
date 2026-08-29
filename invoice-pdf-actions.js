/* Makes the invoice register clear: PDF creates a file for saving or sending,
   while Print remains for paper copies. */
(function(){
  function prepare(){
    document.querySelectorAll('#invoiceTable button[onclick*="printInvoice"]').forEach(function(button){
      if(button.dataset.pdfActionReady)return;
      button.dataset.pdfActionReady='1';
      var source=button.getAttribute('onclick')||'',match=source.match(/printInvoice\(([^)]+)\)/);
      if(!match)return;
      var id=match[1];
      button.textContent='Download PDF';
      button.removeAttribute('onclick');
      button.onclick=function(){
        if(window.downloadInvoicePdf){window.downloadInvoicePdf(id);}
        else if(window.printInvoice){window.printInvoice(id);}
      };
      var print=button.cloneNode(true);
      print.dataset.pdfActionReady='print';
      print.textContent='Print';
      print.onclick=function(){if(window.printInvoice)window.printInvoice(id)};
      button.insertAdjacentElement('afterend',print);
    });
  }
  new MutationObserver(prepare).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('click',function(){setTimeout(prepare,0)});
  window.addEventListener('load',prepare);
})();
