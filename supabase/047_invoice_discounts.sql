-- Optional fixed-amount discount for invoices.
-- total_amount continues to store the final amount due after the discount.

begin;

alter table public.invoices
  add column if not exists discount_amount numeric(14,2) not null default 0
  check (discount_amount >= 0);

commit;
