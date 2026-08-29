-- Clean public booking links and the correct name for 15M's original branch.

begin;

alter table public.branch_appointment_links
  add column if not exists short_code text;

update public.branch_appointment_links
set short_code = lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
where short_code is null or btrim(short_code) = '';

alter table public.branch_appointment_links
  alter column short_code set not null,
  alter column short_code set default lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'branch_appointment_links_short_code_key'
      and conrelid = 'public.branch_appointment_links'::regclass
  ) then
    alter table public.branch_appointment_links
      add constraint branch_appointment_links_short_code_key unique (short_code);
  end if;
end;
$$;

create or replace function public.get_public_appointment_token(p_short_code text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select link.public_token
  from public.branch_appointment_links link
  join public.businesses business on business.id = link.business_id
  join public.branches branch on branch.id = link.branch_id
  where link.short_code = lower(trim(p_short_code))
    and link.enabled = true
    and business.status = 'active'
    and branch.is_active = true
  limit 1;
$$;

revoke all on function public.get_public_appointment_token(text) from public;
grant execute on function public.get_public_appointment_token(text) to anon, authenticated;

-- Changes only the original 15M branch label. Its ID and existing records stay intact.
update public.branches branch
set name = 'STA. ROSA'
from public.businesses business
where branch.business_id = business.id
  and lower(trim(branch.name)) = 'main workspace'
  and upper(trim(business.name)) = '15M AUTOCARE SERVICES';

notify pgrst, 'reload schema';

commit;
