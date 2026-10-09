-- Released units leave Active Vehicles but retain their operational record.
begin;

alter table public.repaint_monitoring_jobs
  add column if not exists released_at timestamptz,
  add column if not exists released_by uuid references auth.users(id) on delete set null;

create index if not exists repaint_monitoring_jobs_active_branch_idx
  on public.repaint_monitoring_jobs (business_id, branch_id, released_at, updated_at desc);

commit;
