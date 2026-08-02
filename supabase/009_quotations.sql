-- Shared quotations and line items for each business workspace.

begin;

create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  quotation_number text not null,
  status text not null default 'Draft' check (status in ('Draft', 'Ready')),
  client_name text not null default '',
  contact_number text not null default '',
  client_address text not null default '',
  vehicle text not null default '',
  plate_number text not null default '',
  quotation_date date not null default current_date,
  valid_until date,
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  details jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, quotation_number)
);

create table if not exists public.quotation_lines (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  category text not null default 'Body & Tinsmith',
  description text not null,
  quantity numeric(12,2) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists quotations_business_date_idx on public.quotations (business_id, quotation_date desc);
create index if not exists quotation_lines_quote_idx on public.quotation_lines (quotation_id, sort_order);

drop trigger if exists set_quotations_updated_at on public.quotations;
create trigger set_quotations_updated_at before update on public.quotations
for each row execute procedure public.set_updated_at();

alter table public.quotations enable row level security;
alter table public.quotation_lines enable row level security;

drop policy if exists quotations_read on public.quotations;
create policy quotations_read on public.quotations for select to authenticated
using (public.is_platform_admin() or public.is_business_member(business_id));

drop policy if exists quotations_manage on public.quotations;
create policy quotations_manage on public.quotations for all to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id))
with check ((public.is_platform_admin() or public.is_business_manager(business_id)) and created_by = auth.uid());

drop policy if exists quotation_lines_read on public.quotation_lines;
create policy quotation_lines_read on public.quotation_lines for select to authenticated
using (exists (select 1 from public.quotations q where q.id = quotation_id and (public.is_platform_admin() or public.is_business_member(q.business_id))));

drop policy if exists quotation_lines_manage on public.quotation_lines;
create policy quotation_lines_manage on public.quotation_lines for all to authenticated
using (exists (select 1 from public.quotations q where q.id = quotation_id and (public.is_platform_admin() or public.is_business_manager(q.business_id))))
with check (exists (select 1 from public.quotations q where q.id = quotation_id and (public.is_platform_admin() or public.is_business_manager(q.business_id))));

commit;
