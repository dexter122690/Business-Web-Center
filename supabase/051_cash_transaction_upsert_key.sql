-- Make the invoice cash-in source key usable by PostgREST upsert.
-- The earlier partial index only enforced uniqueness when source_key was not
-- null, which PostgreSQL cannot infer from ON CONFLICT (branch_id, source_key).
-- A regular unique index still permits any number of manual records with a
-- null source_key, while ensuring one linked cash transaction per branch.

do $$
begin
  if exists (
    select 1
    from public.cash_transactions
    where source_key is not null
    group by branch_id, source_key
    having count(*) > 1
  ) then
    raise exception 'Cannot add the cash transaction upsert key: duplicate non-null source keys exist.';
  end if;
end;
$$;

create unique index if not exists cash_transactions_branch_source_key_upsert_idx
  on public.cash_transactions (branch_id, source_key);
