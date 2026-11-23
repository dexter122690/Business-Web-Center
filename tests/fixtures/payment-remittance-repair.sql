-- SYNTHETIC TEST FIXTURE ONLY. All names and IDs are fictional.
-- Separate from the schema migration: never run as an automatic bulk cleanup.
begin;
do $repair$
declare
  i public.invoices%rowtype; p public.invoice_payments%rowtype; c public.cash_collections%rowtype;
  original public.invoice_payments%rowtype; before_hash text; after_hash text; backup jsonb;
begin
  select * into i from public.invoices where id='22222222-2222-4222-8222-111111111111'
    and business_id='11111111-1111-4111-8111-111111111111' and branch_id='11111111-1111-4111-8111-222222222222' for update;
  if not found or i.invoice_number<>176 or i.client_name<>'Fictional remittance client' or i.total_amount<>61000 or i.amount_paid<>61000 or i.status<>'Paid' then
    raise exception 'Invoice no longer matches the verified repair scope. Nothing changed.';
  end if;
  select * into p from public.invoice_payments where id='22222222-2222-4222-8222-444444444444' and invoice_id=i.id for update;
  select * into original from public.invoice_payments where id='22222222-2222-4222-8222-222222222222' and invoice_id=i.id for update;
  select * into c from public.cash_collections where id='33333333-3333-4333-8333-111111111111' and invoice_id=i.id for update;
  if p.id is null or original.id is null or c.id is null then raise exception 'Required linked records not found.'; end if;
  if p.payment_method='GCash' and c.amount=5000 and c.payment_id=original.id and not exists
    (select 1 from public.cash_transactions where source_key='invoice-payment-cash:'||i.id::text||':'||p.id::text) then
    raise notice 'This exact repair was already completed.'; return;
  end if;
  if p.amount<>26000 or p.payment_date<>'2026-11-23' or p.payment_method<>'Cash'
    or original.amount<>5000 or original.payment_method<>'Cash' or original.payment_date<>'2026-10-22'
    or c.amount<>61000 or c.status<>'Remitted' or c.payment_id is not null
    or c.remitted_at<>'2026-10-27 09:24:59.812+00'::timestamptz then
    raise exception 'Payment/remittance changed since inspection. Nothing changed.';
  end if;
  if not exists(select 1 from public.audit_logs a where a.entity_type='cash_collections' and a.entity_id=c.id::text
     and a.details->'before'->>'status'='Pending remittance' and a.details->'after'->>'status'='Remitted'
     and (a.details->'after'->>'amount')::numeric=5000 and a.details->'after'->>'remitted_at'=to_jsonb(c)->>'remitted_at') then
    raise exception 'Original 5000 remittance audit could not be verified.';
  end if;
  if (select count(*) from public.invoice_payments where invoice_id=i.id)<>3
     or not exists(select 1 from public.invoice_payments where invoice_id=i.id and amount=30000 and payment_method='Bank transfer' and payment_date='2026-11-03') then
    raise exception 'Unexpected payment history. Nothing changed.';
  end if;
  -- Fingerprint every unaffected row in the four connected financial tables.
  select md5(jsonb_build_object(
    'invoices',(select jsonb_agg(to_jsonb(x) order by id) from public.invoices x),
    'payments',(select jsonb_agg(to_jsonb(x) order by id) from public.invoice_payments x where id<>p.id),
    'collections',(select jsonb_agg(to_jsonb(x) order by id) from public.cash_collections x where id<>c.id),
    'cash',(select jsonb_agg(to_jsonb(x) order by id) from public.cash_transactions x where source_key is distinct from 'invoice-payment-cash:'||i.id::text||':'||p.id::text)
  )::text) into before_hash;
  backup=jsonb_build_object('payment',to_jsonb(p),'collection',to_jsonb(c),'cash',
    (select jsonb_agg(to_jsonb(x)) from public.cash_transactions x where source_key='invoice-payment-cash:'||i.id::text||':'||p.id::text));
  -- Restore the actual amount marked on Oct 27; preserve record ID, actor and time.
  update public.cash_collections set amount=5000,payment_id=original.id,updated_at=now() where id=c.id;
  delete from public.cash_collection_legacy_payments where collection_id=c.id;
  update public.invoice_payments set payment_method='GCash' where id=p.id;
  perform public.sync_invoice_payment_cash(i.id,i.branch_id);
  select md5(jsonb_build_object(
    'invoices',(select jsonb_agg(to_jsonb(x) order by id) from public.invoices x),
    'payments',(select jsonb_agg(to_jsonb(x) order by id) from public.invoice_payments x where id<>p.id),
    'collections',(select jsonb_agg(to_jsonb(x) order by id) from public.cash_collections x where id<>c.id),
    'cash',(select jsonb_agg(to_jsonb(x) order by id) from public.cash_transactions x where source_key is distinct from 'invoice-payment-cash:'||i.id::text||':'||p.id::text)
  )::text) into after_hash;
  if before_hash is distinct from after_hash then raise exception 'Unexpected unrelated financial change; entire repair rolled back.'; end if;
  if (select coalesce(sum(amount),0) from public.cash_transactions where branch_id=i.branch_id and source_key like 'invoice-payment-cash:'||i.id::text||':%')<>5000
    or (select sum(amount) from public.invoice_payments where invoice_id=i.id)<>61000 then
    raise exception 'Repair totals failed verification; entire repair rolled back.';
  end if;
  insert into public.audit_logs(business_id,branch_id,actor_name,action,entity_type,entity_id,details)
  values(i.business_id,i.branch_id,'System — owner-authorized support repair','corrected','invoice_payment',i.id::text,
    jsonb_build_object('reason','Owner approved correction of Nov 23 payment method Cash to GCash and restoration of original Oct 27 remittance; no new payment or money transfer.',
      'payment_id',p.id,'before',backup,'after_payment',(select to_jsonb(x) from public.invoice_payments x where id=p.id),
      'after_collection',(select to_jsonb(x) from public.cash_collections x where id=c.id),'unaffected_financial_hash',after_hash));
end;
$repair$;
commit;
