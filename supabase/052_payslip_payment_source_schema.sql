-- Restore the payslip payment-source column expected by payroll-online.js.
-- Existing payslips intentionally remain NULL because historic records may not
-- have a recorded payment source.

begin;

alter table public.payslips
  add column if not exists payment_source text;

alter table public.payslips
  drop constraint if exists payslips_payment_source_check;

alter table public.payslips
  add constraint payslips_payment_source_check
  check (payment_source is null or payment_source in ('CIB', 'Petty Cash', 'Authorized Manager'));

comment on column public.payslips.payment_source is
  'Payment source selected when a payslip is issued. Historic payslips may remain empty.';

commit;
