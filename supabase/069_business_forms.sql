-- Shared Forms folder: metadata is branch-scoped and files live in a private
-- Supabase Storage bucket. Apply this migration in Supabase SQL Editor.
begin;

create table if not exists public.business_forms (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  storage_path text not null unique,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists business_forms_branch_created_idx
  on public.business_forms(business_id, branch_id, created_at desc);

alter table public.business_forms enable row level security;

drop policy if exists business_forms_read on public.business_forms;
create policy business_forms_read on public.business_forms
for select to authenticated
using (public.can_view_invoice_branch(business_id, branch_id));

drop policy if exists business_forms_insert on public.business_forms;
create policy business_forms_insert on public.business_forms
for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and public.can_manage_invoice_branch(business_id, branch_id)
);

drop policy if exists business_forms_delete on public.business_forms;
create policy business_forms_delete on public.business_forms
for delete to authenticated
using (public.can_manage_invoice_branch(business_id, branch_id));

insert into storage.buckets (id, name, public)
values ('business-forms', 'business-forms', false)
on conflict (id) do update set public = false;

drop policy if exists business_forms_storage_read on storage.objects;
create policy business_forms_storage_read on storage.objects
for select to authenticated
using (
  bucket_id = 'business-forms'
  and public.can_view_invoice_branch(
    nullif((storage.foldername(name))[1], '')::uuid,
    nullif((storage.foldername(name))[2], '')::uuid
  )
);

drop policy if exists business_forms_storage_insert on storage.objects;
create policy business_forms_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'business-forms'
  and public.can_manage_invoice_branch(
    nullif((storage.foldername(name))[1], '')::uuid,
    nullif((storage.foldername(name))[2], '')::uuid
  )
);

drop policy if exists business_forms_storage_delete on storage.objects;
create policy business_forms_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'business-forms'
  and public.can_manage_invoice_branch(
    nullif((storage.foldername(name))[1], '')::uuid,
    nullif((storage.foldername(name))[2], '')::uuid
  )
);

commit;
