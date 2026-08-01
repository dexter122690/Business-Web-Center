-- Creates a pending business request automatically when a user signs up.
-- This migration is safe to run after schema.sql.

begin;

alter table public.profiles
  add column if not exists mobile_number text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_business_name text;
begin
  insert into public.profiles (id, email, full_name, mobile_number)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'mobile_number', '')), '')
  )
  on conflict (id) do nothing;

  requested_business_name := nullif(
    trim(coalesce(new.raw_user_meta_data ->> 'business_name', '')),
    ''
  );

  if requested_business_name is not null then
    insert into public.businesses (name, status, created_by)
    values (requested_business_name, 'pending', new.id);
  end if;

  return new;
end;
$$;

commit;
