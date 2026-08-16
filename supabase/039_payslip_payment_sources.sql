-- Records the funding source selected when an approved payslip is issued.
-- Historic payslips are intentionally allowed to remain blank.

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
