-- One safe public feedback link per business. The link can submit a comment only;
-- it cannot read business data or any existing feedback.

begin;

create table if not exists public.business_feedback_links (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  public_token uuid not null unique default gen_random_uuid(),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_business_feedback_links_updated_at on public.business_feedback_links;
create trigger set_business_feedback_links_updated_at before update on public.business_feedback_links
for each row execute procedure public.set_updated_at();

alter table public.business_feedback_links enable row level security;

drop policy if exists feedback_links_read on public.business_feedback_links;
create policy feedback_links_read on public.business_feedback_links
for select to authenticated
using (public.is_platform_admin() or public.is_business_member(business_id));

drop policy if exists feedback_links_manager_create on public.business_feedback_links;
create policy feedback_links_manager_create on public.business_feedback_links
for insert to authenticated
with check (public.is_platform_admin() or public.is_business_manager(business_id));

drop policy if exists feedback_links_manager_update on public.business_feedback_links;
create policy feedback_links_manager_update on public.business_feedback_links
for update to authenticated
using (public.is_platform_admin() or public.is_business_manager(business_id))
with check (public.is_platform_admin() or public.is_business_manager(business_id));

create or replace function public.submit_public_feedback(p_token uuid, p_feedback text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_business uuid;
  feedback_id uuid;
begin
  select l.business_id into target_business
  from public.business_feedback_links l
  join public.businesses b on b.id = l.business_id
  where l.public_token = p_token and l.enabled = true and b.status = 'active';

  if target_business is null then
    raise exception 'This feedback link is no longer active.';
  end if;

  if char_length(trim(coalesce(p_feedback, ''))) = 0 then
    raise exception 'Please write your feedback.';
  end if;

  insert into public.business_feedback (business_id, client_name, feedback_text, source)
  values (target_business, 'Anonymous client', trim(p_feedback), 'public_qr')
  returning id into feedback_id;

  return feedback_id;
end;
$$;

revoke all on function public.submit_public_feedback(uuid, text) from public;
grant execute on function public.submit_public_feedback(uuid, text) to anon, authenticated;

commit;
