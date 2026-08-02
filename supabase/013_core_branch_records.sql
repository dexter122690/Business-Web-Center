-- Separate the first core records by branch while preserving all existing records.
begin;

insert into public.branches (business_id, name)
select b.id, 'Main workspace'
from public.businesses b
where not exists (select 1 from public.branches br where br.business_id = b.id);

alter table public.invoices add column if not exists branch_id uuid references public.branches(id) on delete restrict;
alter table public.expenses add column if not exists branch_id uuid references public.branches(id) on delete restrict;
alter table public.quotations add column if not exists branch_id uuid references public.branches(id) on delete restrict;
alter table public.scheduled_appointments add column if not exists branch_id uuid references public.branches(id) on delete restrict;

update public.invoices t set branch_id = (select br.id from public.branches br where br.business_id=t.business_id order by br.created_at limit 1) where t.branch_id is null;
update public.expenses t set branch_id = (select br.id from public.branches br where br.business_id=t.business_id order by br.created_at limit 1) where t.branch_id is null;
update public.quotations t set branch_id = (select br.id from public.branches br where br.business_id=t.business_id order by br.created_at limit 1) where t.branch_id is null;
update public.scheduled_appointments t set branch_id = (select br.id from public.branches br where br.business_id=t.business_id order by br.created_at limit 1) where t.branch_id is null;

alter table public.invoices alter column branch_id set not null;
alter table public.expenses alter column branch_id set not null;
alter table public.quotations alter column branch_id set not null;
alter table public.scheduled_appointments alter column branch_id set not null;

alter table public.quotations drop constraint if exists quotations_business_id_quotation_number_key;
create unique index if not exists quotations_business_branch_number_key on public.quotations (business_id, branch_id, quotation_number);

create index if not exists invoices_branch_date_idx on public.invoices (branch_id, invoice_date desc);
create index if not exists expenses_branch_date_idx on public.expenses (branch_id, expense_date desc);
create index if not exists quotations_branch_date_idx on public.quotations (branch_id, quotation_date desc);
create index if not exists appointments_branch_date_idx on public.scheduled_appointments (branch_id, scheduled_date, scheduled_time);

drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices for insert to authenticated
with check ((public.is_platform_admin() or public.is_business_manager(business_id)) and created_by=auth.uid() and exists (select 1 from public.branches br where br.id=branch_id and br.business_id=business_id and br.is_active));
drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices for update to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id))
with check ((public.is_platform_admin() or public.is_business_manager(business_id)) and exists (select 1 from public.branches br where br.id=branch_id and br.business_id=business_id and br.is_active));

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated
with check ((public.is_platform_admin() or public.is_business_manager(business_id)) and created_by=auth.uid() and exists (select 1 from public.branches br where br.id=branch_id and br.business_id=business_id and br.is_active));
drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id))
with check ((public.is_platform_admin() or public.is_business_manager(business_id)) and exists (select 1 from public.branches br where br.id=branch_id and br.business_id=business_id and br.is_active));

drop policy if exists quotations_manage on public.quotations;
create policy quotations_manage on public.quotations for all to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id))
with check ((public.is_platform_admin() or public.is_business_manager(business_id)) and exists (select 1 from public.branches br where br.id=branch_id and br.business_id=business_id and br.is_active));

drop policy if exists scheduled_appointments_manage on public.scheduled_appointments;
create policy scheduled_appointments_manage on public.scheduled_appointments for all to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id))
with check ((public.is_platform_admin() or public.is_business_manager(business_id)) and exists (select 1 from public.branches br where br.id=branch_id and br.business_id=business_id and br.is_active));

commit;
