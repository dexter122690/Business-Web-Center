-- New payroll only. Never resumes, deletes, or writes legacy payroll/expenses.
begin;
create table if not exists public.payroll_v2_settings (
 business_id uuid primary key references public.businesses(id) on delete restrict,
 enabled boolean not null default false
);
create table if not exists public.payroll_v2_access (
 business_id uuid not null references public.businesses(id) on delete restrict,
 branch_id uuid not null references public.branches(id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete restrict,
 access_level text not null check(access_level in ('view','edit')),
 granted_by uuid not null references auth.users(id),
 primary key(business_id,branch_id,user_id)
);
create table if not exists public.payroll_v2_workspaces (
 business_id uuid not null references public.businesses(id) on delete restrict,
 branch_id uuid not null references public.branches(id) on delete restrict,
 state jsonb not null, revision bigint not null default 1,
 updated_at timestamptz not null default now(), updated_by uuid references auth.users(id),
 primary key(business_id,branch_id), check(jsonb_typeof(state)='object')
);
create table if not exists public.payroll_v2_directory (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete restrict,
 branch_id uuid not null references public.branches(id) on delete restrict,
 local_id text not null, full_name text not null, position text not null,
 is_active boolean not null default true,
 unique(business_id,branch_id,local_id)
);
-- Private files are separately stored, never in the shared employee directory.
-- Inline bytes make initial browser-to-server migration atomic; no public URLs.
create table if not exists public.payroll_v2_files (
 business_id uuid not null references public.businesses(id) on delete restrict,
 branch_id uuid not null references public.branches(id) on delete restrict,
 file_id text not null, kind text not null check(kind in ('photo','pdf')),
 data_url text not null check(octet_length(data_url)<=15000000),
 created_at timestamptz not null default now(), created_by uuid references auth.users(id),
 primary key(business_id,branch_id,file_id)
);
create table if not exists public.payroll_v2_events (
 id bigint generated always as identity primary key,
 business_id uuid not null references public.businesses(id) on delete restrict,
 branch_id uuid not null references public.branches(id) on delete restrict,
 actor_id uuid references auth.users(id), action text not null,
 details jsonb not null default '{}', created_at timestamptz not null default now()
);
create table if not exists public.payroll_v2_pending (
 business_id uuid not null references public.businesses(id) on delete restrict,
 local_id text not null, profile jsonb not null,
 primary key(business_id,local_id)
);
alter table public.payroll_v2_pending enable row level security;
revoke all on public.payroll_v2_pending from public,anon,authenticated;
alter table public.payroll_v2_settings enable row level security;
alter table public.payroll_v2_access enable row level security;
alter table public.payroll_v2_workspaces enable row level security;
alter table public.payroll_v2_directory enable row level security;
alter table public.payroll_v2_files enable row level security;
alter table public.payroll_v2_events enable row level security;
-- Only validated RPCs can read/write confidential payroll tables.
revoke all on public.payroll_v2_settings,public.payroll_v2_access,public.payroll_v2_workspaces,public.payroll_v2_directory,public.payroll_v2_files,public.payroll_v2_events from anon,authenticated;

create or replace function public.payroll_v2_role(b uuid,r uuid) returns text
language sql stable security definer set search_path=public as $$
 select case when not exists(select 1 from payroll_v2_settings s join businesses x on x.id=s.business_id join branches y on y.business_id=x.id where s.business_id=b and s.enabled and x.status='active' and y.id=r and y.is_active) then 'none'
 when exists(select 1 from business_memberships where business_id=b and user_id=auth.uid() and role='owner' and status='active') then 'owner'
 else coalesce((select a.access_level from payroll_v2_access a join business_memberships m on m.business_id=a.business_id and m.user_id=a.user_id join business_member_branch_access z on z.business_id=a.business_id and z.user_id=a.user_id and z.branch_id=a.branch_id where a.business_id=b and a.branch_id=r and a.user_id=auth.uid() and m.status='active'),'none') end;
$$;
create or replace function public.payroll_v2_public_employee(e jsonb) returns jsonb
language sql immutable set search_path=public as $$
 select e - array['assignedBranch','mobileNumber','address','emergencyContactName','emergencyContactNumber','emergencyRelationship','payoutAccountType','bankName','accountName','accountNumber','photos'];
$$;
create or replace function public.payroll_v2_redact(s jsonb) returns jsonb
language sql immutable set search_path=public as $$
 select jsonb_set(s,'{employees}',coalesce((select jsonb_agg(payroll_v2_public_employee(e) order by ord) from jsonb_array_elements(s->'employees') with ordinality a(e,ord)),'[]'));
$$;
create or replace function public.payroll_v2_empty() returns jsonb
language sql stable set search_path=public as $$
 select jsonb_build_object('version',3,'period',jsonb_build_object('start',(current_date-((extract(dow from current_date)::int+1)%7))::text,'end',(current_date-((extract(dow from current_date)::int+1)%7)+6)::text,'releaseDate',(current_date-((extract(dow from current_date)::int+1)%7)+7)::text),'rules',jsonb_build_object('lateMode','deduct','hoursPerDay',8),'employees','[]'::jsonb,'jobs','[]'::jsonb,'payments','[]'::jsonb,'releases','[]'::jsonb,'advances','[]'::jsonb,'attendance','[]'::jsonb,'payslips','[]'::jsonb,'plans','[]'::jsonb,'slipReleases','[]'::jsonb,'legacyReleases','[]'::jsonb,'painterTestSheets','[]'::jsonb,'releasedPainterSlips','[]'::jsonb,'payrollPaydays','{}'::jsonb);
$$;
create or replace function public.payroll_v2_load(b uuid,r uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare access text; w payroll_v2_workspaces%rowtype; data jsonb;
begin
 access:=payroll_v2_role(b,r);if access='none' then raise exception 'Payroll access is not enabled for this account and branch.' using errcode='42501';end if;
 select * into w from payroll_v2_workspaces where business_id=b and branch_id=r;
 data:=coalesce(w.state,payroll_v2_empty());
 if access<>'owner' then data:=payroll_v2_redact(data);end if;
 return jsonb_build_object('state',data,'revision',coalesce(w.revision,0),'access',access,'branchName',(select name from branches where id=r and business_id=b),'pendingEmployees',case when access='owner' then coalesce((select jsonb_agg(jsonb_build_object('id',local_id,'name',profile->>'name','archived',profile->'archived')) from payroll_v2_pending where business_id=b),'[]') else '[]'::jsonb end);
end $$;
create or replace function public.payroll_v2_validate(s jsonb) returns void
language plpgsql set search_path=public as $$
declare k text; e jsonb; sh jsonb; rw jsonb; total numeric; net numeric;
begin
 if s is null or jsonb_typeof(s)<>'object' or coalesce(s->>'version','')<>'3' or octet_length(s::text)>8000000 then raise exception 'Invalid or oversized payroll workspace';end if;
 foreach k in array array['employees','jobs','payments','releases','advances','attendance','payslips','plans','slipReleases','legacyReleases','painterTestSheets','releasedPainterSlips'] loop
  if coalesce(jsonb_typeof(s->k),'')<>'array' then raise exception 'Invalid payroll collection: %',k;end if;
 end loop;
 if coalesce((s#>>'{rules,hoursPerDay}')::numeric,0) not between 1 and 24 or coalesce(s#>>'{rules,lateMode}','') not in ('record','deduct') then raise exception 'Invalid payroll rules';end if;
 if coalesce((s#>>'{period,end}')::date-(s#>>'{period,start}')::date,0)<>6 or extract(dow from (s#>>'{period,start}')::date)<>6 or (s#>>'{period,releaseDate}')::date is null then raise exception 'Choose a Saturday-Friday payroll week';end if;
 if exists(select 1 from jsonb_array_elements(s->'employees') x group by x->>'id' having count(*)>1) then raise exception 'Duplicate employee ID';end if;
 for e in select * from jsonb_array_elements(s->'employees') loop
  if coalesce(e->>'id','')='' or coalesce(trim(e->>'name'),'')='' or coalesce(trim(e->>'position'),'')='' or coalesce(e->>'type','') not in ('daily','contract') or coalesce((e->>'rate')::numeric,-1) not between 0 and 999999999 or length(e->>'name')>100 then raise exception 'Invalid employee profile';end if;
 end loop;
 for e in select * from jsonb_array_elements(s->'attendance') loop
  if not exists(select 1 from jsonb_array_elements(s->'employees') p where p->>'id'=e->>'employeeId' and p->>'type'='daily') or (e->>'date')::date is null or coalesce(e->>'status','') not in ('unset','present','absent','late','rest') or coalesce((e->>'lateMinutes')::numeric,0) not between 0 and 1440 or coalesce((e->>'overtimeMinutes')::numeric,0) not between 0 and 1440 then raise exception 'Invalid attendance';end if;
 end loop;
 for sh in select * from jsonb_array_elements(s->'painterTestSheets') loop
  if coalesce(sh->>'id','')='' or coalesce(jsonb_typeof(sh#>'{snapshot,rows}'),'')<>'array' or (sh#>>'{period,start}')::date is null or (sh#>>'{period,end}')::date-(sh#>>'{period,start}')::date<>6 or extract(dow from (sh#>>'{period,start}')::date)<>6 or (sh#>>'{period,releaseDate}')::date is null then raise exception 'Invalid saved worksheet';end if;
  if not exists(select 1 from jsonb_array_elements(s->'employees') p where p->>'id'=sh->>'employeeId' and p->>'type'='contract') or sh#>'{snapshot,period}'<>sh->'period' or coalesce(sh#>>'{snapshot,employee,id}','')<>sh->>'employeeId' then raise exception 'Invalid painter payslip';end if;
  total:=0;
  for rw in select * from jsonb_array_elements(sh#>'{snapshot,rows}') loop
   if coalesce(rw#>>'{job,unit}','')='' or coalesce(rw#>>'{job,employeeId}','')<>sh->>'employeeId' or coalesce((rw->>'weekly')::numeric,-1) not between 0 and 999999999 or coalesce((rw#>>'{job,contract}')::numeric,-1) not between 0 and 999999999 or (rw->>'opening')::numeric is null or (rw->>'remaining')::numeric is null or round((rw->>'remaining')::numeric,2)<>round((rw->>'opening')::numeric-(rw->>'weekly')::numeric,2) then raise exception 'Invalid painter amount';end if;
   total:=total+(rw->>'weekly')::numeric;
  end loop;
  if (sh#>>'{snapshot,basic}')::numeric is null or (sh#>>'{snapshot,net}')::numeric is null or round(total,2)<>round((sh#>>'{snapshot,basic}')::numeric,2) or coalesce((sh#>>'{snapshot,cashAdvance}')::numeric,-1) not between 0 and 999999999 or round(total-(sh#>>'{snapshot,cashAdvance}')::numeric,2)<>round((sh#>>'{snapshot,net}')::numeric,2) then raise exception 'Painter totals do not match';end if;
 end loop;
 for sh in select * from jsonb_array_elements(s->'releasedPainterSlips') loop
  if coalesce(sh->>'id','')='' or (sh->>'releasedOn')::date is null or coalesce((sh->>'releasedCopy')::boolean,false)=false then raise exception 'Invalid released painter copy';end if;
  select x->'snapshot' into e from jsonb_array_elements(s->'painterTestSheets') x where x->>'id'=sh->>'sourceId' and x->>'employeeId'=sh->>'employeeId' and x->'period'=sh->'period';
  if e is null or ((sh->'snapshot')-'previousPayments')<>(e-'previousPayments') then raise exception 'Released copy must match its saved worksheet';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(s->'releasedPainterSlips') x group by x->>'employeeId',x#>>'{period,start}',x#>>'{period,end}' having count(*)>1) then raise exception 'This payroll week has already been released';end if;
 for sh in select * from jsonb_array_elements(s->'payslips') loop
  if coalesce(sh->>'id','')='' or not exists(select 1 from jsonb_array_elements(s->'employees') p where p->>'id'=sh->>'employeeId') or coalesce(sh#>>'{snapshot,employee,id}','')<>sh->>'employeeId' or sh->'period' is distinct from sh#>'{snapshot,period}' or (sh#>>'{period,start}')::date is null or (sh#>>'{period,end}')::date-(sh#>>'{period,start}')::date<>6 or extract(dow from (sh#>>'{period,start}')::date)<>6 then raise exception 'Invalid daily payslip';end if;
  e:=sh->'snapshot';net:=(e->>'basic')::numeric-(e->>'late')::numeric-(e->>'held')::numeric+(e->>'retentionReleased')::numeric-(e->>'cashAdvance')::numeric;
  if net is null or (e->>'net')::numeric is null or round(net,2)<>round((e->>'net')::numeric,2) then raise exception 'Payslip totals do not match';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(s->'payslips') x join jsonb_array_elements(s->'payslips') y on x->>'id'<y->>'id' and x->>'employeeId'=y->>'employeeId' and x#>>'{period,start}'<=y#>>'{period,end}' and x#>>'{period,end}'>=y#>>'{period,start}') then raise exception 'Overlapping daily payslips';end if;
 foreach k in array array['painterTestSheets','releasedPainterSlips','payslips'] loop
  if exists(select 1 from jsonb_array_elements(s->k) x group by x->>'id' having count(*)>1) then raise exception 'Duplicate payslip ID';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(s->'attendance') x group by x->>'employeeId',x->>'date' having count(*)>1) then raise exception 'Duplicate attendance day';end if;
 for e in select * from jsonb_array_elements(s->'slipReleases') loop
  if not exists(select 1 from jsonb_array_elements(s->'payslips') p where p->>'id'=e->>'slipId' and (p#>>'{period,releaseDate}')::date<=(e->>'date')::date) or (e->>'date')::date is null then raise exception 'Invalid payslip release confirmation';end if;
 end loop;
end $$;
create or replace function public.payroll_v2_sync_directory(b uuid,r uuid,s jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare e jsonb;
begin
 for e in select * from jsonb_array_elements(s->'employees') loop
  insert into payroll_v2_directory(business_id,branch_id,local_id,full_name,position,is_active) values(b,r,e->>'id',e->>'name',e->>'position',not coalesce((e->>'archived')::boolean,false))
  on conflict(business_id,branch_id,local_id) do update set full_name=excluded.full_name,position=excluded.position,is_active=excluded.is_active;
 end loop;
end $$;
create or replace function public.payroll_v2_save(b uuid,r uuid,expected_revision bigint,payload jsonb,files jsonb default '[]') returns jsonb
language plpgsql security definer set search_path=public as $$
declare access text; w payroll_v2_workspaces%rowtype; old jsonb; next_state jsonb:=payload; k text; e jsonb; f jsonb; previous_file text; current_revision bigint;
begin
 access:=payroll_v2_role(b,r);if access not in ('owner','edit') then raise exception 'This account cannot save payroll for this branch.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(b::text||r::text,0));
 select * into w from payroll_v2_workspaces where business_id=b and branch_id=r for update;
 current_revision:=coalesce(w.revision,0);if current_revision<>expected_revision then raise exception 'Another user saved changes. Reload payroll before saving again.' using errcode='40001';end if;
 old:=coalesce(w.state,payroll_v2_empty());
 if expected_revision is null then raise exception 'A save revision is required';end if;
 if access<>'owner' then
  if next_state->'employees' is distinct from payroll_v2_redact(old)->'employees' or next_state->'rules' is distinct from old->'rules' then raise exception 'Only the owner can manage employees and payroll rules.' using errcode='42501';end if;
  next_state:=jsonb_set(next_state,'{employees}',old->'employees');
 end if;
 perform payroll_v2_validate(next_state);
 -- A released week cannot acquire a new competing worksheet through a direct API call.
 for e in select * from jsonb_array_elements(old->'releasedPainterSlips') loop
  if exists(select 1 from jsonb_array_elements(next_state->'painterTestSheets') n where n->>'employeeId'=e->>'employeeId' and n#>>'{period,start}'=e#>>'{period,start}' and not exists(select 1 from jsonb_array_elements(old->'painterTestSheets') o where o->>'id'=n->>'id')) then raise exception 'Void the released payslip before correcting this week';end if;
 end loop;
 for e in select p from jsonb_array_elements(old->'payslips') p where exists(select 1 from jsonb_array_elements(old->'slipReleases') c where c->>'slipId'=p->>'id') loop
  foreach k in array array['attendance','advances'] loop
   if (select coalesce(jsonb_agg(x order by x::text),'[]') from jsonb_array_elements(old->k) x where x->>'employeeId'=e->>'employeeId' and x->>'date' between e#>>'{period,start}' and e#>>'{period,end}') is distinct from (select coalesce(jsonb_agg(x order by x::text),'[]') from jsonb_array_elements(next_state->k) x where x->>'employeeId'=e->>'employeeId' and x->>'date' between e#>>'{period,start}' and e#>>'{period,end}') then raise exception 'Void the released payslip before changing its attendance or deductions';end if;
  end loop;
 end loop;
 for e in select * from jsonb_array_elements(old->'employees') loop
  if not exists(select 1 from jsonb_array_elements(next_state->'employees') p where p->>'id'=e->>'id') then raise exception 'Archive an employee instead of deleting their records';end if;
 end loop;
 foreach k in array array['painterTestSheets','releasedPainterSlips','payslips','slipReleases','legacyReleases'] loop
  for e in select * from jsonb_array_elements(old->k) loop
   if not exists(select 1 from jsonb_array_elements(next_state->k) x where x=e) then raise exception 'Saved payroll history is read-only. Use the owner correction process.';end if;
  end loop;
 end loop;
 if files is null or jsonb_typeof(files)<>'array' or jsonb_array_length(files)>30 then raise exception 'Invalid payroll files';end if;
 for f in select * from jsonb_array_elements(files) loop
  if coalesce(f->>'id','')='' or coalesce(f->>'kind','') not in ('photo','pdf') then raise exception 'Invalid payroll file';end if;
  if f->>'kind'='photo' then
   if access<>'owner' or not exists(select 1 from jsonb_array_elements(next_state->'employees') p cross join lateral jsonb_array_elements(coalesce(p->'photos','[]')) photo where photo->>'id'=f->>'id') or coalesce(f->>'dataUrl','') !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' then raise exception 'Invalid employee photo';end if;
  else
   if not exists(select 1 from jsonb_array_elements(next_state->'releasedPainterSlips') p where p->>'id'=f->>'id') and not exists(select 1 from jsonb_array_elements(next_state->'payslips') p where p->>'id'=f->>'id') then raise exception 'PDF needs a saved payslip';end if;
   if coalesce(f->>'dataUrl','') !~ '^data:application/pdf;base64,JVBERi0[A-Za-z0-9+/=]+$' then raise exception 'Invalid PDF';end if;
  end if;
  select data_url into previous_file from payroll_v2_files where business_id=b and branch_id=r and file_id=f->>'id';
  if previous_file is not null and previous_file<>f->>'dataUrl' then raise exception 'Existing files cannot be overwritten';end if;
  insert into payroll_v2_files(business_id,branch_id,file_id,kind,data_url,created_by) values(b,r,f->>'id',f->>'kind',f->>'dataUrl',auth.uid()) on conflict do nothing;
 end loop;
 -- A release is successful only when its permanent PDF exists in the same transaction.
 for e in select * from jsonb_array_elements(next_state->'releasedPainterSlips') loop
  if not exists(select 1 from payroll_v2_files where business_id=b and branch_id=r and file_id=e->>'id' and kind='pdf') then raise exception 'Generate the PDF before releasing the payslip';end if;
 end loop;
 for e in select * from jsonb_array_elements(next_state->'slipReleases') loop
  if not exists(select 1 from payroll_v2_files where business_id=b and branch_id=r and file_id=e->>'slipId' and kind='pdf') then raise exception 'Generate the PDF before releasing the payslip';end if;
 end loop;
 insert into payroll_v2_workspaces(business_id,branch_id,state,revision,updated_by) values(b,r,next_state,current_revision+1,auth.uid()) on conflict(business_id,branch_id) do update set state=excluded.state,revision=excluded.revision,updated_at=now(),updated_by=excluded.updated_by;
 perform payroll_v2_sync_directory(b,r,next_state);
 insert into payroll_v2_events(business_id,branch_id,actor_id,action,details) values(b,r,auth.uid(),'save',jsonb_build_object('revision',current_revision+1,'employees',jsonb_array_length(next_state->'employees'),'test_copies',jsonb_array_length(next_state->'painterTestSheets'),'released',jsonb_array_length(next_state->'releasedPainterSlips')+jsonb_array_length(next_state->'slipReleases')));
 return payroll_v2_load(b,r);
end $$;
create or replace function public.payroll_v2_get_files(b uuid,r uuid,ids text[]) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare access text;
begin
 access:=payroll_v2_role(b,r);if access='none' then raise exception 'Payroll access denied' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',file_id,'dataUrl',data_url,'kind',kind)) from payroll_v2_files where business_id=b and branch_id=r and file_id=any(ids) and (access='owner' or kind='pdf')),'[]');
end $$;
create or replace function public.payroll_v2_team(b uuid,r uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if payroll_v2_role(b,r)<>'owner' then raise exception 'Owner access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'name',p.full_name,'email',p.email,'level',coalesce(a.access_level,'none'))) from business_memberships m join profiles p on p.id=m.user_id join business_member_branch_access z on z.business_id=m.business_id and z.user_id=m.user_id and z.branch_id=r left join payroll_v2_access a on a.business_id=m.business_id and a.branch_id=r and a.user_id=m.user_id where m.business_id=b and m.status='active' and m.role<>'owner'),'[]');
end $$;
create or replace function public.payroll_v2_grant(b uuid,r uuid,member uuid,level text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if payroll_v2_role(b,r)<>'owner' then raise exception 'Owner access required' using errcode='42501';end if;
 if level not in ('none','view','edit') or not exists(select 1 from business_memberships m join business_member_branch_access z on z.business_id=m.business_id and z.user_id=m.user_id where m.business_id=b and m.user_id=member and m.status='active' and m.role<>'owner' and z.branch_id=r) then raise exception 'Choose an active branch team member';end if;
 if level='none' then delete from payroll_v2_access where business_id=b and branch_id=r and user_id=member;
 else insert into payroll_v2_access values(b,r,member,level,auth.uid()) on conflict(business_id,branch_id,user_id) do update set access_level=excluded.access_level,granted_by=excluded.granted_by;end if;
 insert into payroll_v2_events(business_id,branch_id,actor_id,action,details) values(b,r,auth.uid(),'access',jsonb_build_object('member',member,'level',level));
end $$;
create or replace function public.payroll_v2_employee_options(b uuid,r uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if not exists(select 1 from branches where id=r and business_id=b and is_active) or not can_view_invoice_branch(b,r) then raise exception 'Branch employee access denied' using errcode='42501';end if;
 return coalesce((select jsonb_agg(x order by x->>'full_name') from (
  select jsonb_build_object('id',id,'full_name',full_name,'position',position,'is_active',is_active,'source','new') x from payroll_v2_directory where business_id=b and branch_id=r and is_active
  union all
  select jsonb_build_object('id',w.id,'full_name',w.full_name,'position',w.position,'is_active',w.is_active,'source','legacy') x from payroll_workers w where w.business_id=b and w.branch_id=r and w.is_active and not exists(select 1 from payroll_v2_directory d where d.business_id=b and d.branch_id=r and lower(trim(d.full_name))=lower(trim(w.full_name)))
 ) options),'[]');
end $$;
-- Additive link only. Historical technician_worker_id values remain untouched.
alter table public.pms_service_records add column if not exists technician_employee_id uuid references public.payroll_v2_directory(id) on delete restrict;
create or replace function public.payroll_v2_check_pms_employee() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.technician_employee_id is not null and not exists(select 1 from payroll_v2_directory where id=new.technician_employee_id and business_id=new.business_id and branch_id=new.branch_id) then raise exception 'Technician belongs to another branch';end if;return new;
end $$;
drop trigger if exists payroll_v2_check_pms_employee on public.pms_service_records;
create trigger payroll_v2_check_pms_employee before insert or update of technician_employee_id,business_id,branch_id on public.pms_service_records for each row execute function public.payroll_v2_check_pms_employee();
-- Internal helpers are never callable through the public API.
create or replace function public.payroll_v2_assign_employee(b uuid,r uuid,local_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare person jsonb; data jsonb; rev bigint;
begin
 if payroll_v2_role(b,r)<>'owner' then raise exception 'Owner access required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(b::text||r::text,0));
 select profile into person from payroll_v2_pending p where p.business_id=b and p.local_id=payroll_v2_assign_employee.local_id for update;
 if person is null then raise exception 'This profile has already been assigned';end if;
 select state,revision into data,rev from payroll_v2_workspaces where business_id=b and branch_id=r for update;
 data:=coalesce(data,payroll_v2_empty());rev:=coalesce(rev,0);
 if exists(select 1 from jsonb_array_elements(data->'employees') e where e->>'id'=person->>'id') then raise exception 'Employee ID already exists in this branch';end if;
 person:=jsonb_set(person,'{assignedBranch}',to_jsonb((select name from branches where id=r and business_id=b)));
 data:=jsonb_set(data,'{employees}',(data->'employees')||jsonb_build_array(person));
 perform payroll_v2_save(b,r,rev,data,'[]');
 delete from payroll_v2_pending p where p.business_id=b and p.local_id=payroll_v2_assign_employee.local_id;
 insert into payroll_v2_events(business_id,branch_id,actor_id,action,details) values(b,r,auth.uid(),'assign_employee',jsonb_build_object('employee_id',local_id));
 return payroll_v2_load(b,r);
end $$;
create or replace function public.payroll_v2_void(b uuid,r uuid,slip_id text,reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare w payroll_v2_workspaces%rowtype; original jsonb; data jsonb; collection text;
begin
 if payroll_v2_role(b,r)<>'owner' then raise exception 'Only the owner can void a released payslip' using errcode='42501';end if;
 if length(trim(coalesce(reason,'')))<5 or length(reason)>1000 then raise exception 'Enter a meaningful reason (5–1000 characters)';end if;
 perform pg_advisory_xact_lock(hashtextextended(b::text||r::text,0));
 select * into w from payroll_v2_workspaces where business_id=b and branch_id=r for update;
 data:=w.state;collection:='releasedPainterSlips';
 select e into original from jsonb_array_elements(data->collection) e where e->>'id'=slip_id;
 if original is null then
  collection:='payslips';select e into original from jsonb_array_elements(data->collection) e where e->>'id'=slip_id;
 end if;
 if original is null then raise exception 'Payslip not found';end if;
 insert into payroll_v2_events(business_id,branch_id,actor_id,action,details) values(b,r,auth.uid(),'void',jsonb_build_object('reason',trim(reason),'original',original,'collection',collection));
 data:=jsonb_set(data,array[collection],coalesce((select jsonb_agg(e) from jsonb_array_elements(data->collection) e where e->>'id'<>slip_id),'[]'));
 if collection='payslips' then data:=jsonb_set(data,'{slipReleases}',coalesce((select jsonb_agg(e) from jsonb_array_elements(data->'slipReleases') e where e->>'slipId'<>slip_id),'[]'));end if;
 update payroll_v2_workspaces set state=data,revision=w.revision+1,updated_at=now(),updated_by=auth.uid() where business_id=b and branch_id=r;
 -- The original PDF and full audit snapshot are deliberately preserved.
 return payroll_v2_load(b,r);
end $$;
revoke all on function public.payroll_v2_assign_employee(uuid,uuid,text),public.payroll_v2_void(uuid,uuid,text,text) from public,anon;
grant execute on function public.payroll_v2_assign_employee(uuid,uuid,text),public.payroll_v2_void(uuid,uuid,text,text) to authenticated;
revoke all on function public.payroll_v2_public_employee(jsonb),public.payroll_v2_redact(jsonb),public.payroll_v2_empty(),public.payroll_v2_validate(jsonb),public.payroll_v2_sync_directory(uuid,uuid,jsonb),public.payroll_v2_check_pms_employee() from public,anon,authenticated;
revoke all on function public.payroll_v2_role(uuid,uuid),public.payroll_v2_load(uuid,uuid),public.payroll_v2_save(uuid,uuid,bigint,jsonb,jsonb),public.payroll_v2_get_files(uuid,uuid,text[]),public.payroll_v2_team(uuid,uuid),public.payroll_v2_grant(uuid,uuid,uuid,text),public.payroll_v2_employee_options(uuid,uuid) from public,anon;
grant execute on function public.payroll_v2_role(uuid,uuid),public.payroll_v2_load(uuid,uuid),public.payroll_v2_save(uuid,uuid,bigint,jsonb,jsonb),public.payroll_v2_get_files(uuid,uuid,text[]),public.payroll_v2_team(uuid,uuid),public.payroll_v2_grant(uuid,uuid,uuid,text),public.payroll_v2_employee_options(uuid,uuid) to authenticated;
insert into public.payroll_v2_settings(business_id,enabled) values('ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875',true) on conflict do nothing;
commit;
