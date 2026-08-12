-- Automatic branch work board.  Invoice data remains the source of truth;
-- this table stores only the operational progress chosen by the business.
begin;

create table if not exists public.work_board_units (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  status text not null default 'Received'
    check (status in ('Received','In Progress','Quality Check','Ready for Release','Completed')),
  notes text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, branch_id, invoice_id)
);

create index if not exists work_board_units_branch_idx
  on public.work_board_units (business_id, branch_id, status, updated_at desc);

drop trigger if exists set_work_board_units_updated_at on public.work_board_units;
create trigger set_work_board_units_updated_at before update on public.work_board_units
for each row execute procedure public.set_updated_at();

alter table public.work_board_units enable row level security;

drop policy if exists work_board_units_read on public.work_board_units;
create policy work_board_units_read on public.work_board_units for select to authenticated
using (public.is_platform_admin() or public.is_business_member(business_id));

drop policy if exists work_board_units_manage on public.work_board_units;
create policy work_board_units_manage on public.work_board_units for all to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id))
with check (
  (public.is_platform_admin() or public.is_business_manager(business_id))
  and exists (select 1 from public.branches b where b.id = branch_id and b.business_id = business_id and b.is_active)
);

commit;
