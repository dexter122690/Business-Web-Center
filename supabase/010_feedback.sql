-- Shared client feedback for each business workspace.

begin;

create table if not exists public.business_feedback (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_name text not null default 'Anonymous client',
  rating smallint check (rating between 1 and 5),
  feedback_text text not null check (char_length(trim(feedback_text)) > 0),
  source text not null default 'client',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists business_feedback_business_created_idx
  on public.business_feedback (business_id, created_at desc);

alter table public.business_feedback enable row level security;

drop policy if exists business_feedback_read on public.business_feedback;
create policy business_feedback_read on public.business_feedback
for select to authenticated
using (public.is_platform_admin() or public.is_business_member(business_id));

drop policy if exists business_feedback_add on public.business_feedback;
create policy business_feedback_add on public.business_feedback
for insert to authenticated
with check (
  (public.is_platform_admin() or public.is_business_member(business_id))
  and created_by = auth.uid()
);

commit;
