-- Retry-safe invoice creation. A single transaction includes the header,
-- lines, opening payment, CIB and optional PMS history. No existing rows change.
begin;
create table if not exists public.invoice_upload_receipts (
 request_id uuid primary key,
 business_id uuid not null references public.businesses(id) on delete cascade,
 branch_id uuid not null references public.branches(id) on delete restrict,
 created_by uuid not null references auth.users(id) on delete restrict,
 fingerprint text not null,
 invoice_id uuid references public.invoices(id) on delete set null,
 result jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.invoice_upload_receipts enable row level security;
revoke all on public.invoice_upload_receipts from public,anon,authenticated;

create or replace function public.create_invoice_from_outbox(
 p_business_id uuid,p_branch_id uuid,p_request_id uuid,p_payload jsonb,
 p_services jsonb,p_parts jsonb,p_payment jsonb default '{}',p_pms jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 prior public.invoice_upload_receipts%rowtype; saved public.invoices%rowtype;
 fingerprint text; result jsonb; paid numeric(14,2); technician uuid; employee uuid;
begin
 if auth.uid() is null or p_request_id is null or
    public.can_manage_invoice_branch(p_business_id,p_branch_id) is distinct from true or
    not exists(select 1 from branches br join businesses b on b.id=br.business_id where br.id=p_branch_id and br.business_id=p_business_id and br.is_active and b.status='active') then
  raise exception 'Sign in with invoice-edit access to the original branch.' using errcode='42501';
 end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_services) is distinct from 'array' or jsonb_typeof(p_parts) is distinct from 'array' or jsonb_typeof(p_payment) is distinct from 'object' or jsonb_typeof(p_pms) is distinct from 'object' then raise exception 'Invalid invoice upload.';end if;
 if jsonb_array_length(p_services)+jsonb_array_length(p_parts)>300 or octet_length(jsonb_build_array(p_payload,p_services,p_parts,p_payment,p_pms)::text)>1000000 then raise exception 'Invoice upload is too large.';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_payload,p_services,p_parts,p_payment,p_pms)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into prior from invoice_upload_receipts where request_id=p_request_id;
 if found then
  if prior.business_id<>p_business_id or prior.branch_id<>p_branch_id or prior.created_by<>auth.uid() or prior.fingerprint<>fingerprint then raise exception 'This upload reference was already used for a different invoice or account.';end if;
  if prior.invoice_id is null then raise exception 'This invoice was already uploaded and later deleted online. Ask the owner to review; it will not be recreated.';end if;
  return prior.result;
 end if;
 -- Start at zero received. update_invoice_with_lines validates all required
 -- fields and derives totals from the lines, never the browser's totals.
 insert into invoices(business_id,branch_id,client_name,contact_number,client_address,vehicle_make,vehicle_year_model,vehicle_color,plate_number,invoice_date,assigned_admin,payment_method,client_source,total_amount,amount_paid,status,created_by)
 values(p_business_id,p_branch_id,coalesce(p_payload->>'client_name',''),coalesce(p_payload->>'contact_number',''),coalesce(p_payload->>'client_address',''),coalesce(p_payload->>'vehicle_make',''),coalesce(p_payload->>'vehicle_year_model',''),coalesce(p_payload->>'vehicle_color',''),coalesce(p_payload->>'plate_number',''),(p_payload->>'invoice_date')::date,coalesce(p_payload->>'assigned_admin',''),coalesce(p_payload->>'payment_method',''),coalesce(p_payload->>'client_source',''),0,0,'Pending',auth.uid()) returning * into saved;
 perform public.update_invoice_with_lines(saved.id,p_branch_id,p_payload,p_services,p_parts);
 select * into saved from invoices where id=saved.id;
 paid:=coalesce((p_payment->>'amount')::numeric,0);
 if paid::text in ('NaN','Infinity','-Infinity') or paid<0 or paid>saved.total_amount or saved.total_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Initial payment must be between zero and the invoice total.';end if;
 if exists(select 1 from invoice_services where invoice_id=saved.id and amount::text='NaN') or exists(select 1 from invoice_parts where invoice_id=saved.id and (quantity::text='NaN' or unit_price::text='NaN')) then raise exception 'Line amounts must be finite numbers.';end if;
 if paid>0 then
  if nullif(p_payment->>'date','') is null then raise exception 'Enter the actual initial-payment date.';end if;
  insert into invoice_payments(invoice_id,business_id,branch_id,payment_date,amount,payment_method,reference_number,notes,created_by)
  values(saved.id,p_business_id,p_branch_id,(p_payment->>'date')::date,paid,saved.payment_method,'Initial recorded payment','Initial payment recorded when the invoice was created.',auth.uid());
  update invoices set amount_paid=paid,status=case when paid>=total_amount then 'Paid' else 'Partially paid' end where id=saved.id;
 end if;
 perform public.sync_invoice_payment_cash(saved.id,p_branch_id);
 if exists(select 1 from invoice_services where invoice_id=saved.id and service_name ~* '\mPMS\M') then
  technician:=nullif(p_pms->>'technician_worker_id','')::uuid;employee:=nullif(p_pms->>'technician_employee_id','')::uuid;
  if technician is not null and not exists(select 1 from payroll_workers where id=technician and business_id=p_business_id and branch_id=p_branch_id) then raise exception 'PMS technician belongs to another branch.';end if;
  if employee is not null and not exists(select 1 from payroll_v2_directory where id=employee and business_id=p_business_id and branch_id=p_branch_id) then raise exception 'PMS employee belongs to another branch.';end if;
  insert into pms_service_records(business_id,branch_id,invoice_id,client_name,contact_number,client_email,vehicle_make,vehicle_year_model,vehicle_color,plate_number,service_date,odometer_km,technician_worker_id,technician_employee_id,technician_name,next_pms_date,next_pms_odometer_km,notes,created_by)
  values(p_business_id,p_branch_id,saved.id,saved.client_name,saved.contact_number,saved.client_email,saved.vehicle_make,saved.vehicle_year_model,saved.vehicle_color,saved.plate_number,saved.invoice_date,nullif(p_pms->>'odometer_km','')::numeric,technician,employee,p_pms->>'technician_name',nullif(p_pms->>'next_pms_date','')::date,nullif(p_pms->>'next_pms_odometer_km','')::numeric,p_pms->>'notes',auth.uid());
 end if;
 result:=jsonb_build_object('request_id',p_request_id,'business_id',p_business_id,'branch_id',p_branch_id,'created_by',auth.uid(),'invoice_id',saved.id,'invoice_number',saved.invoice_number);
 insert into invoice_upload_receipts(request_id,business_id,branch_id,created_by,fingerprint,invoice_id,result) values(p_request_id,p_business_id,p_branch_id,auth.uid(),fingerprint,saved.id,result);
 return result;
end $$;
revoke all on function public.create_invoice_from_outbox(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.create_invoice_from_outbox(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;
commit;
