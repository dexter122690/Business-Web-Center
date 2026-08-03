-- Auditable payroll adjustments: bonuses and other deductions.
-- Run after migrations 006, 016, and 020.

begin;

create table if not exists public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  worker_id uuid not null references public.payroll_workers(id) on delete restrict,
  adjustment_date date not null default current_date,
  adjustment_type text not null check (adjustment_type in ('bonus', 'deduction')),
  amount numeric(14,2) not null check (amount > 0),
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'cancelled')),
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists payroll_adjustments_branch_date_idx
  on public.payroll_adjustments (branch_id, adjustment_date desc);
create index if not exists payroll_adjustments_worker_idx
  on public.payroll_adjustments (branch_id, worker_id, status);

alter table public.payroll_adjustments enable row level security;

drop policy if exists payroll_adjustments_read on public.payroll_adjustments;
create policy payroll_adjustments_read on public.payroll_adjustments
for select to authenticated
using (
  public.is_platform_admin()
  or (
    public.is_business_member(business_id)
    and exists (
      select 1 from public.branches br
      where br.id = branch_id and br.business_id = business_id and br.is_active
    )
  )
);

drop policy if exists payroll_adjustments_manage on public.payroll_adjustments;
create policy payroll_adjustments_manage on public.payroll_adjustments
for all to authenticated
using (
  public.is_platform_admin()
  or (
    public.is_business_manager(business_id)
    and exists (
      select 1 from public.branches br
      where br.id = branch_id and br.business_id = business_id and br.is_active
    )
  )
)
with check (
  public.is_platform_admin()
  or (
    public.is_business_manager(business_id)
    and exists (
      select 1 from public.branches br
      where br.id = branch_id and br.business_id = business_id and br.is_active
    )
  )
);

commit;
