-- Attendance review workflow for payroll.
-- Run this in the Supabase SQL Editor after migrations 006 and 016.
-- Existing attendance stays approved so current payroll is not interrupted.

begin;

alter table public.payroll_attendance
  add column if not exists attendance_approved boolean not null default true,
  add column if not exists attendance_approved_at timestamptz,
  add column if not exists attendance_approved_by uuid references auth.users(id) on delete set null;

-- Any existing record was already usable in payroll before this review feature.
-- Keep it usable; new or corrected entries are explicitly saved as waiting review.
update public.payroll_attendance
set attendance_approved = true
where attendance_approved is null;

create index if not exists payroll_attendance_branch_review_idx
  on public.payroll_attendance (branch_id, attendance_approved, work_date desc);

commit;
