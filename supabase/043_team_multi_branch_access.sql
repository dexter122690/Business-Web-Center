-- Allow one staff email to have a separate Team Access record for each branch.
-- Run once in Supabase SQL Editor after deploying the matching website update.

begin;

do $$
declare
  invite_email_constraint text;
begin
  select conname into invite_email_constraint
  from pg_constraint
  where conrelid = 'public.business_team_invites'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) = 'UNIQUE (business_id, email)';

  if invite_email_constraint is not null then
    execute format('alter table public.business_team_invites drop constraint %I', invite_email_constraint);
  end if;
end $$;

alter table public.business_team_invites
  add constraint business_team_invites_business_email_branch_key
  unique (business_id, email, branch_id);

create index if not exists business_team_invites_business_email_idx
  on public.business_team_invites (business_id, lower(email));

commit;
