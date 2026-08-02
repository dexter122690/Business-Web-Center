-- Track cash received from invoices until it is remitted to the business owner.
begin;

create table if not exists public.cash_collections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  invoice_id uuid not null unique references public.invoices(id) on delete cascade,
  received_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  received_by text,
  status text not null default 'Pending remittance' check (status in ('Pending remittance','Remitted')),
  remitted_at timestamptz,
  remitted_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cash_collections_branch_status_idx on public.cash_collections (branch_id, status, received_date desc);

create or replace function public.sync_invoice_cash_collection()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if lower(trim(coalesce(new.payment_method,''))) = 'cash' and coalesce(new.amount_paid,0) > 0 then
    insert into public.cash_collections (business_id, branch_id, invoice_id, received_date, amount, received_by)
    values (new.business_id, new.branch_id, new.id, new.invoice_date, new.amount_paid, new.assigned_admin)
    on conflict (invoice_id) do update set
      business_id=excluded.business_id,
      branch_id=excluded.branch_id,
      received_date=excluded.received_date,
      amount=excluded.amount,
      received_by=excluded.received_by,
      updated_at=now();
  else
    delete from public.cash_collections
    where invoice_id=new.id and status='Pending remittance';
  end if;
  return new;
end;
$$;

drop trigger if exists sync_invoice_cash_collection on public.invoices;
create trigger sync_invoice_cash_collection
after insert or update of payment_method, amount_paid, branch_id, invoice_date, assigned_admin on public.invoices
for each row execute procedure public.sync_invoice_cash_collection();

insert into public.cash_collections (business_id, branch_id, invoice_id, received_date, amount, received_by)
select i.business_id, i.branch_id, i.id, i.invoice_date, i.amount_paid, i.assigned_admin
from public.invoices i
where lower(trim(coalesce(i.payment_method,'')))='cash' and i.amount_paid > 0
on conflict (invoice_id) do update set
  business_id=excluded.business_id,
  branch_id=excluded.branch_id,
  received_date=excluded.received_date,
  amount=excluded.amount,
  received_by=excluded.received_by,
  updated_at=now();

alter table public.cash_collections enable row level security;

drop policy if exists cash_collections_read on public.cash_collections;
create policy cash_collections_read on public.cash_collections for select to authenticated
using (public.is_platform_admin() or public.is_business_member(business_id));

drop policy if exists cash_collections_update on public.cash_collections;
create policy cash_collections_update on public.cash_collections for update to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id))
with check (public.is_platform_admin() or public.is_business_manager(business_id));

commit;
