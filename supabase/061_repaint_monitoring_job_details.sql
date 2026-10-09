-- Additional editable unit details and the flexible procedure mode.
begin;

alter table public.repaint_monitoring_jobs
  add column if not exists vehicle_color text;

alter table public.repaint_monitoring_jobs
  drop constraint if exists repaint_monitoring_jobs_work_label_check;

alter table public.repaint_monitoring_jobs
  add constraint repaint_monitoring_jobs_work_label_check
  check (work_label in ('Washover', 'Per Panel Work', 'Other Procedure'));

commit;
