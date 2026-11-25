/* New isolated payroll surface. The paused #payroll module is never re-enabled. */
(function(){
 'use strict';
 const BUSINESS='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875';let checking=false,context='',button,section,observer;
 function hide(){
  if(button){button.hidden=true;button.classList.remove('active')}
  if(section){const wasActive=section.classList.contains('active');section.replaceChildren();section.classList.remove('active');if(wasActive){document.getElementById('dashboard')?.classList.add('active');document.querySelector('#nav [data-t="dashboard"]')?.classList.add('active')}}
  context='';
 }
 function show(){
  if(!button||button.hidden)return;
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el===section));
  document.querySelectorAll('#nav button').forEach(el=>el.classList.toggle('active',el===button));
  if(!section.querySelector('iframe')){const frame=document.createElement('iframe');frame.src='payroll-v2/index.html?v=20261125-job-items';frame.title='15M Payroll';frame.style.cssText='width:100%;height:calc(100vh - 155px);min-height:720px;border:0;display:block';section.append(frame)}
  window.scrollTo(0,0);
 }
 async function check(){
  const b=localStorage.getItem('bwc-active-business'),r=localStorage.getItem('bwc-active-branch'),db=window.getBusinessSupabaseClient?.();
  if(context&&context!==b+':'+r)hide();
  if(b!==BUSINESS||!r||!db){hide();return}if(checking)return;checking=true;
  try{
   const result=await db.rpc('payroll_v2_role',{b,r});if(b!==localStorage.getItem('bwc-active-business')||r!==localStorage.getItem('bwc-active-branch')){hide();setTimeout(check,0);return}if(result.error||!['owner','view','edit'].includes(result.data)){hide();return}
   const nav=document.getElementById('nav'),old=document.getElementById('payroll');if(!nav||!old)return;
   if(!section){section=document.createElement('section');section.id='payrollV2';section.className='view';section.style.padding='0';old.after(section)}
   if(!button){button=document.createElement('button');button.type='button';button.dataset.t='payrollV2';button.dataset.payrollV2='true';button.textContent='Payroll';button.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();show()})}
   if(context!==b+':'+r){section.replaceChildren();context=b+':'+r}button.hidden=false;
   if(!nav.contains(button))nav.append(button);
   if(!observer){observer=new MutationObserver(()=>{if(button&&!button.hidden&&!nav.contains(button))nav.append(button)});observer.observe(nav,{childList:true,subtree:true})}
  }catch(error){hide();console.warn('New payroll access check failed. Other modules remain available.')}finally{checking=false}
 }
 document.addEventListener('bwc:business-ready',check);document.addEventListener('bwc:branch-ready',check);
 window.addEventListener('storage',event=>{if(['bwc-active-business','bwc-active-branch'].includes(event.key))check()});
 window.addEventListener('focus',check);
 window.addEventListener('load',()=>{check();setTimeout(check,1500);setTimeout(check,4500)});
 setTimeout(check,500);
})();
