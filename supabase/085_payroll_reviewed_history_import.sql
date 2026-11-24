-- Private, owner-authorized historical imports wait for a compatible client.
-- This migration stages nothing and changes no payroll records by itself.
begin;
create table if not exists public.payroll_v2_history_imports (
 id text primary key,
 business_id uuid not null,
 branch_id uuid not null,
 employee_id text not null,
 expected_revision bigint not null,
 before_sheets jsonb not null,
 before_releases jsonb not null,
 worksheets jsonb not null,
 released_copies jsonb not null,
 files jsonb not null default '[]',
 review_note text not null,
 created_at timestamptz not null default now(),
 applied_at timestamptz,
 applied_by uuid,
 applied_revision bigint
);
alter table public.payroll_v2_history_imports enable row level security;
revoke all on public.payroll_v2_history_imports from public,anon,authenticated;
create or replace function public.payroll_v2_apply_reviewed_history(b uuid,r uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare q payroll_v2_history_imports%rowtype; w payroll_v2_workspaces%rowtype; next_state jsonb; result jsonb; count_applied integer:=0;
begin
 if public.payroll_v2_role(b,r)<>'owner' then return jsonb_build_object('status','none');end if;
 perform pg_advisory_xact_lock(hashtextextended(b::text||r::text,0));
 for q in select * from payroll_v2_history_imports where business_id=b and branch_id=r and applied_at is null order by created_at,id for update loop
  select * into w from payroll_v2_workspaces where business_id=b and branch_id=r for update;
  if w.revision is distinct from q.expected_revision then return jsonb_build_object('status','stale','message','Historical payroll is waiting for review because payroll changed after it was prepared. Existing records were not overwritten.');end if;
  if not exists(select 1 from jsonb_array_elements(w.state->'employees') e where e->>'id'=q.employee_id and e->>'type'='contract') then raise exception 'Historical payroll employee not found';end if;
  if (select coalesce(jsonb_agg(s),'[]') from jsonb_array_elements(w.state->'painterTestSheets') s where s->>'employeeId'=q.employee_id) is distinct from q.before_sheets
   or (select coalesce(jsonb_agg(s),'[]') from jsonb_array_elements(w.state->'releasedPainterSlips') s where s->>'employeeId'=q.employee_id) is distinct from q.before_releases then raise exception 'Historical payroll source changed';end if;
  if jsonb_typeof(q.worksheets)<>'array' or jsonb_typeof(q.released_copies)<>'array' or jsonb_typeof(q.files)<>'array'
   or exists(select 1 from jsonb_array_elements(q.worksheets||q.released_copies) s where s->>'employeeId' is distinct from q.employee_id)
   or exists(select 1 from jsonb_array_elements(q.files) f where f->>'kind' is distinct from 'pdf' or not exists(select 1 from jsonb_array_elements(q.released_copies) s where s->>'id'=f->>'id')) then raise exception 'Historical import must contain only the reviewed employee payroll and PDFs';end if;
  next_state:=jsonb_set(w.state,'{painterTestSheets}',(select coalesce(jsonb_agg(s),'[]') from jsonb_array_elements(w.state->'painterTestSheets') s where s->>'employeeId'<>q.employee_id)||q.worksheets);
  next_state:=jsonb_set(next_state,'{releasedPainterSlips}',(select coalesce(jsonb_agg(s),'[]') from jsonb_array_elements(w.state->'releasedPainterSlips') s where s->>'employeeId'<>q.employee_id)||q.released_copies);
  -- Reuse all owner, revision, immutable-history, PDF, and amount safeguards.
  result:=public.payroll_v2_save(b,r,w.revision,next_state,q.files);
  update payroll_v2_history_imports set applied_at=now(),applied_by=auth.uid(),applied_revision=(result->>'revision')::bigint where id=q.id;
  insert into payroll_v2_events(business_id,branch_id,actor_id,action,details) values(b,r,auth.uid(),'reviewed_history_import',jsonb_build_object('import_id',q.id,'employee_id',q.employee_id,'review_note',q.review_note,'revision',result->'revision'));
  count_applied:=count_applied+1;
 end loop;
 return jsonb_build_object('status',case when count_applied>0 then 'applied' else 'none' end,'count',count_applied);
end $$;
revoke all on function public.payroll_v2_apply_reviewed_history(uuid,uuid) from public,anon;
grant execute on function public.payroll_v2_apply_reviewed_history(uuid,uuid) to authenticated;
commit;
