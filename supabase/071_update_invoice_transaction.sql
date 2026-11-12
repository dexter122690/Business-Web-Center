-- Atomically update an existing invoice and all of its editable line items.
-- Payment history and cash movements are deliberately left untouched.

begin;

create or replace function public.update_invoice_with_lines(
  p_invoice_id uuid,
  p_branch_id uuid,
  p_payload jsonb,
  p_services jsonb default '[]'::jsonb,
  p_parts jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_service jsonb;
  v_part jsonb;
  v_subtotal numeric(14,2) := 0;
  v_discount numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_history_paid numeric(14,2) := 0;
  v_paid numeric(14,2) := 0;
  v_written_off numeric(14,2) := 0;
  v_status text;
  v_service_count integer := 0;
  v_part_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Invoice details are invalid.';
  end if;
  if jsonb_typeof(coalesce(p_services, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_parts, '[]'::jsonb)) <> 'array' then
    raise exception 'Invoice services and parts must be arrays.';
  end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id
    and branch_id = p_branch_id
  for update;

  if not found then
    raise exception 'Invoice was not found in the selected branch.';
  end if;

  if not public.can_manage_invoice_branch(v_invoice.business_id, p_branch_id) then
    raise exception 'You do not have permission to edit invoices in this branch.';
  end if;

  if nullif(trim(p_payload->>'client_name'), '') is null
     or nullif(trim(p_payload->>'contact_number'), '') is null
     or nullif(trim(p_payload->>'client_address'), '') is null
     or nullif(trim(p_payload->>'vehicle_make'), '') is null
     or nullif(trim(p_payload->>'vehicle_year_model'), '') is null
     or nullif(trim(p_payload->>'vehicle_color'), '') is null
     or nullif(trim(p_payload->>'plate_number'), '') is null
     or nullif(trim(p_payload->>'invoice_date'), '') is null
     or nullif(trim(p_payload->>'assigned_admin'), '') is null
     or nullif(trim(p_payload->>'payment_method'), '') is null
     or nullif(trim(p_payload->>'client_source'), '') is null then
    raise exception 'Complete every required invoice field before saving.';
  end if;

  begin
    v_discount := round(coalesce(nullif(trim(p_payload->>'discount_amount'), '')::numeric, 0), 2);
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Discount amount is invalid.';
  end;

  if v_discount < 0 then
    raise exception 'Discount cannot be negative.';
  end if;

  for v_service in select value from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) loop
    if nullif(trim(v_service->>'service_name'), '') is null then
      raise exception 'Every service row needs a name.';
    end if;
    if nullif(trim(v_service->>'amount'), '') is null then
      raise exception 'Every service row needs an amount.';
    end if;
    begin
      if (v_service->>'amount')::numeric < 0 then
        raise exception 'Service amounts cannot be negative.';
      end if;
      v_subtotal := v_subtotal + round((v_service->>'amount')::numeric, 2);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'A service amount is invalid.';
    end;
    v_service_count := v_service_count + 1;
  end loop;

  for v_part in select value from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb)) loop
    if nullif(trim(v_part->>'part_name'), '') is null then
      raise exception 'Every part row needs a name.';
    end if;
    begin
      if (v_part->>'quantity')::numeric <= 0 then
        raise exception 'Part quantities must be greater than zero.';
      end if;
      if (v_part->>'unit_price')::numeric < 0 then
        raise exception 'Part prices cannot be negative.';
      end if;
      v_subtotal := v_subtotal + round((v_part->>'quantity')::numeric * (v_part->>'unit_price')::numeric, 2);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'A part quantity or price is invalid.';
    end;
    v_part_count := v_part_count + 1;
  end loop;

  if v_service_count = 0 and v_part_count = 0 then
    raise exception 'Add at least one service or auto part.';
  end if;

  v_subtotal := round(v_subtotal, 2);
  if v_discount > v_subtotal then
    raise exception 'Discount cannot be higher than the services and parts total.';
  end if;
  v_total := round(v_subtotal - v_discount, 2);
  if v_total <= 0 then
    raise exception 'The invoice total must be greater than zero.';
  end if;

  -- The amount collected is authoritative from the existing invoice and its
  -- installment history. The edit request cannot overwrite or reduce it.
  select coalesce(sum(amount), 0) into v_history_paid
  from public.invoice_payments
  where invoice_id = v_invoice.id
    and business_id = v_invoice.business_id
    and branch_id = p_branch_id;
  v_paid := greatest(coalesce(v_invoice.amount_paid, 0), v_history_paid);
  if v_paid > v_total then
    raise exception 'The new total cannot be lower than the amount already received (PHP %).', to_char(v_paid, 'FM999999999990.00');
  end if;

  select coalesce(sum(amount), 0) into v_written_off
  from public.invoice_balance_writeoffs
  where invoice_id = v_invoice.id;
  v_status := case
    when v_written_off > 0 then 'Closed - unremitted collection'
    when v_paid >= v_total then 'Paid'
    when v_paid > 0 then 'Partially paid'
    else 'Pending'
  end;

  update public.invoices
  set client_name = trim(p_payload->>'client_name'),
      contact_number = trim(p_payload->>'contact_number'),
      client_address = trim(p_payload->>'client_address'),
      client_email = nullif(trim(coalesce(p_payload->>'client_email', '')), ''),
      vehicle_make = trim(p_payload->>'vehicle_make'),
      vehicle_year_model = trim(p_payload->>'vehicle_year_model'),
      vehicle_color = trim(p_payload->>'vehicle_color'),
      plate_number = trim(p_payload->>'plate_number'),
      invoice_date = (p_payload->>'invoice_date')::date,
      release_date = nullif(trim(coalesce(p_payload->>'release_date', '')), '')::date,
      assigned_admin = trim(p_payload->>'assigned_admin'),
      payment_method = trim(p_payload->>'payment_method'),
      client_source = trim(p_payload->>'client_source'),
      discount_amount = v_discount,
      total_amount = v_total,
      amount_paid = v_paid,
      status = v_status
  where id = v_invoice.id
    and business_id = v_invoice.business_id
    and branch_id = p_branch_id;

  delete from public.invoice_services where invoice_id = v_invoice.id;
  delete from public.invoice_parts where invoice_id = v_invoice.id;

  insert into public.invoice_services (invoice_id, service_name, service_detail, amount)
  select v_invoice.id,
         trim(value->>'service_name'),
         nullif(trim(coalesce(value->>'service_detail', '')), ''),
         round((value->>'amount')::numeric, 2)
  from jsonb_array_elements(coalesce(p_services, '[]'::jsonb));

  insert into public.invoice_parts (invoice_id, part_name, quantity, unit_price)
  select v_invoice.id,
         trim(value->>'part_name'),
         round((value->>'quantity')::numeric, 2),
         round((value->>'unit_price')::numeric, 2)
  from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb));

  return jsonb_build_object(
    'ok', true,
    'invoice_id', v_invoice.id,
    'invoice_number', v_invoice.invoice_number,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'total', v_total,
    'amount_paid', v_paid,
    'status', v_status,
    'service_count', v_service_count,
    'part_count', v_part_count
  );
end;
$$;

grant execute on function public.update_invoice_with_lines(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;

commit;
