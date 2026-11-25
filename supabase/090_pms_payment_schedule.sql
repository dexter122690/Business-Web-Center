-- PMS next visit = full-payment date + six calendar months.
-- No payment, invoice amount, payroll or cash records are changed.
begin;

create or replace function public.pms_next_visit(p_invoice_id uuid) returns date
language sql volatile security definer set search_path=public as $$
 select (min(p.payment_date)+interval '6 months')::date
 from (
  select q.payment_date,sum(q.amount) over(order by q.payment_date,q.created_at,q.id rows unbounded preceding) received
  from invoice_payments q join invoices i on i.id=q.invoice_id
  where i.id=p_invoice_id and q.business_id=i.business_id and q.branch_id=i.branch_id
 ) p join invoices i on i.id=p_invoice_id
 where i.total_amount>0 and p.received>=i.total_amount;
$$;

create or replace function public.guard_pms_schedule() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from invoices where id=new.invoice_id and business_id=new.business_id and branch_id=new.branch_id) then raise exception 'PMS invoice does not belong to this business and branch.';end if;
 new.next_pms_date:=public.pms_next_visit(new.invoice_id);
 return new;
end $$;
create or replace function public.guard_pms_odometer() returns trigger
language plpgsql set search_path=public as $$
begin
 if new.odometer_km is null or new.next_pms_odometer_km is null then raise exception 'Both PMS odometer readings are required.';end if;
 if new.odometer_km::text in ('NaN','Infinity','-Infinity') or new.next_pms_odometer_km::text in ('NaN','Infinity','-Infinity') then raise exception 'Enter valid PMS odometer readings.';end if;
 return new;
end $$;
drop trigger if exists pms_schedule_guard on public.pms_service_records;
create trigger pms_schedule_guard before insert or update on public.pms_service_records for each row execute function public.guard_pms_schedule();
drop trigger if exists pms_odometer_guard on public.pms_service_records;
create trigger pms_odometer_guard before insert or update of odometer_km,next_pms_odometer_km on public.pms_service_records for each row execute function public.guard_pms_odometer();

create or replace function public.refresh_pms_schedule() returns trigger
language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
 if tg_table_name='invoices' then target:=new.id;
 elsif tg_op='DELETE' then target:=old.invoice_id;
 else target:=new.invoice_id;end if;
 if not exists(select 1 from invoices where id=target) then return null;end if;
 update pms_service_records set next_pms_date=public.pms_next_visit(target)
 where invoice_id=target and next_pms_date is distinct from public.pms_next_visit(target);
 if tg_table_name='invoice_payments' then
  if tg_op='UPDATE' and old.invoice_id<>new.invoice_id then
   update pms_service_records set next_pms_date=public.pms_next_visit(old.invoice_id) where invoice_id=old.invoice_id and next_pms_date is distinct from public.pms_next_visit(old.invoice_id);
  end if;
 end if;
 return null;
end $$;
drop trigger if exists pms_payment_schedule on public.invoice_payments;
create trigger pms_payment_schedule after insert or update or delete on public.invoice_payments for each row execute function public.refresh_pms_schedule();
drop trigger if exists pms_total_schedule on public.invoices;
create trigger pms_total_schedule after update of total_amount on public.invoices for each row execute function public.refresh_pms_schedule();

-- Called only inside the permission-checked invoice transaction. A missing
-- legacy payload preserves existing details, but cannot create incomplete PMS.
create or replace function public.save_invoice_pms(p_invoice_id uuid,p_details jsonb) returns void
language plpgsql set search_path=public as $$
declare i public.invoices%rowtype; prior public.pms_service_records%rowtype; p jsonb; odo numeric; next_odo numeric; worker uuid; employee uuid;
begin
 select * into i from invoices where id=p_invoice_id;
 if not found then raise exception 'PMS invoice not found.';end if;
 if not exists(select 1 from invoice_services where invoice_id=i.id and service_name ~* '\mPMS\M') then
  delete from pms_service_records where invoice_id=i.id;return;
 end if;
 select * into prior from pms_service_records where invoice_id=i.id;
 p:=coalesce(p_details,to_jsonb(prior),'{}'::jsonb);
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'Enter PMS service details.';end if;
 if nullif(btrim(p->>'odometer_km'),'') is null or nullif(btrim(p->>'next_pms_odometer_km'),'') is null then raise exception 'Both PMS odometer readings are required.';end if;
 odo:=(p->>'odometer_km')::numeric;next_odo:=(p->>'next_pms_odometer_km')::numeric;
 if odo::text in ('NaN','Infinity','-Infinity') or next_odo::text in ('NaN','Infinity','-Infinity') or odo<0 or next_odo<0 or odo>9999999999.99 or next_odo>9999999999.99 or odo<>round(odo,2) or next_odo<>round(next_odo,2) then raise exception 'Enter valid non-negative PMS odometer readings (up to 2 decimal places).';end if;
 if length(coalesce(p->>'technician_name',''))>200 then raise exception 'Technician name is too long.';end if;
 worker:=nullif(p->>'technician_worker_id','')::uuid;employee:=nullif(p->>'technician_employee_id','')::uuid;
 if worker is not null and not exists(select 1 from payroll_workers where id=worker and business_id=i.business_id and branch_id=i.branch_id) then raise exception 'PMS technician belongs to another branch.';end if;
 if employee is not null and not exists(select 1 from payroll_v2_directory where id=employee and business_id=i.business_id and branch_id=i.branch_id) then raise exception 'PMS employee belongs to another branch.';end if;
 insert into pms_service_records(business_id,branch_id,invoice_id,client_name,contact_number,client_email,vehicle_make,vehicle_year_model,vehicle_color,plate_number,service_date,odometer_km,technician_worker_id,technician_employee_id,technician_name,next_pms_odometer_km,notes,created_by)
 values(i.business_id,i.branch_id,i.id,i.client_name,i.contact_number,i.client_email,i.vehicle_make,i.vehicle_year_model,i.vehicle_color,i.plate_number,i.invoice_date,odo,worker,employee,nullif(btrim(p->>'technician_name'),''),next_odo,p->>'notes',coalesce(prior.created_by,auth.uid()))
 on conflict(invoice_id) do update set client_name=excluded.client_name,contact_number=excluded.contact_number,client_email=excluded.client_email,vehicle_make=excluded.vehicle_make,vehicle_year_model=excluded.vehicle_year_model,vehicle_color=excluded.vehicle_color,plate_number=excluded.plate_number,service_date=excluded.service_date,odometer_km=excluded.odometer_km,technician_worker_id=excluded.technician_worker_id,technician_employee_id=excluded.technician_employee_id,technician_name=excluded.technician_name,next_pms_odometer_km=excluded.next_pms_odometer_km,notes=excluded.notes;
end $$;

do $patch$
declare definition text; patched text; block_start integer; block_end integer;
begin
 definition:=pg_get_functiondef('public.update_invoice_with_lines(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure);
 if position('perform public.save_invoice_pms(' in definition)=0 then
  patched:=replace(definition,'  return jsonb_build_object(',E'  perform public.save_invoice_pms(v_invoice.id,p_payload->\'pms\');\n  return jsonb_build_object(');
  if patched=definition then raise exception 'Unexpected invoice update definition. Nothing changed.';end if;execute patched;
 end if;
 definition:=pg_get_functiondef('public.create_invoice_from_outbox(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
 if position('p_payload||jsonb_build_object(''pms'',p_pms)' in definition)=0 then
  patched:=replace(definition,'saved.id,p_branch_id,p_payload,p_services,p_parts','saved.id,p_branch_id,p_payload||jsonb_build_object(''pms'',p_pms),p_services,p_parts');
  block_start:=position(' if exists(select 1 from invoice_services where invoice_id=saved.id and service_name' in patched);
  block_end:=position(' result:=jsonb_build_object(' in patched);
  if patched=definition or block_start=0 or block_end<=block_start then raise exception 'Unexpected outbox definition. Nothing changed.';end if;
  patched:=left(patched,block_start-1)||substring(patched from block_end);execute patched;
 end if;
end $patch$;

revoke all on function public.pms_next_visit(uuid),public.guard_pms_schedule(),public.guard_pms_odometer(),public.refresh_pms_schedule(),public.save_invoice_pms(uuid,jsonb) from public,anon,authenticated;

-- Preserve original schedules before recalculating only the owner's BWC PMS
-- records. No guessed mileage or guessed historical payment date is inserted.
create table if not exists public.pms_schedule_090_backup(invoice_id uuid primary key,business_id uuid not null,branch_id uuid not null,previous_next_pms_date date,calculated_next_pms_date date,backed_up_at timestamptz not null default now());
alter table public.pms_schedule_090_backup enable row level security;
revoke all on public.pms_schedule_090_backup from public,anon,authenticated;
insert into public.pms_schedule_090_backup(invoice_id,business_id,branch_id,previous_next_pms_date,calculated_next_pms_date)
select invoice_id,business_id,branch_id,next_pms_date,public.pms_next_visit(invoice_id) from public.pms_service_records
where business_id='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875' and next_pms_date is distinct from public.pms_next_visit(invoice_id)
on conflict(invoice_id) do nothing;
update public.pms_service_records set next_pms_date=public.pms_next_visit(invoice_id)
where business_id='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875' and next_pms_date is distinct from public.pms_next_visit(invoice_id);
commit;
