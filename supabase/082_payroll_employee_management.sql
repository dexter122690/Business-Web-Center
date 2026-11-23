-- Optional, branch-scoped employee management. No account is granted access here.
-- Payroll roles, released-history protection and all other BWC modules stay intact.
begin;
alter table public.payroll_v2_access add column if not exists manage_employees boolean not null default false;

create or replace function public.payroll_v2_can_manage_employees(b uuid,r uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce(public.payroll_v2_role(b,r)='owner' or
  (public.payroll_v2_role(b,r)='edit' and exists(select 1 from public.payroll_v2_access a
   where a.business_id=b and a.branch_id=r and a.user_id=auth.uid() and a.manage_employees)),false);
$$;

create or replace function public.payroll_v2_load(b uuid,r uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare access text; w payroll_v2_workspaces%rowtype; data jsonb; manage boolean;
begin
 access:=payroll_v2_role(b,r);if access='none' then raise exception 'Payroll access is not enabled for this account and branch.' using errcode='42501';end if;
 manage:=payroll_v2_can_manage_employees(b,r);
 select * into w from payroll_v2_workspaces where business_id=b and branch_id=r;
 data:=coalesce(w.state,payroll_v2_empty());
 if not manage then data:=payroll_v2_redact(data);end if;
 return jsonb_build_object('state',data,'revision',coalesce(w.revision,0),'access',access,'canManageEmployees',manage,'branchName',(select name from branches where id=r and business_id=b),'pendingEmployees',case when access='owner' then coalesce((select jsonb_agg(jsonb_build_object('id',local_id,'name',profile->>'name','archived',profile->'archived')) from payroll_v2_pending where business_id=b),'[]') else '[]'::jsonb end);
end $$;

-- Patch only profile/photo authorization; keep the installed 080 save safeguards.
do $patch$
declare definition text; patched text;
 old_guard text := $old$if access<>'owner' then
  if next_state->'employees' is distinct from payroll_v2_redact(old)->'employees' or next_state->'rules' is distinct from old->'rules' then raise exception 'Only the owner can manage employees and payroll rules.' using errcode='42501';end if;
  next_state:=jsonb_set(next_state,'{employees}',old->'employees');
 end if;$old$;
 new_guard text := $new$if access<>'owner' and next_state->'rules' is distinct from old->'rules' then raise exception 'Only the owner can manage payroll rules.' using errcode='42501';end if;
 if not payroll_v2_can_manage_employees(b,r) then
  if next_state->'employees' is distinct from payroll_v2_redact(old)->'employees' then raise exception 'Employee management access is required.' using errcode='42501';end if;
  next_state:=jsonb_set(next_state,'{employees}',old->'employees');
 end if;$new$;
begin
 definition:=pg_get_functiondef('public.payroll_v2_save(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure);
 if position('payroll_v2_check_worksheets(old,next_state)' in definition)=0 then raise exception 'Apply payroll update 080 first';end if;
 if position(new_guard in definition)=0 then
  patched:=replace(definition,old_guard,new_guard);
  if patched=definition then raise exception 'Unexpected payroll save authorization; nothing changed';end if;
  definition:=patched;
  patched:=replace(definition,'if access<>''owner'' or not exists(select 1 from jsonb_array_elements(next_state->''employees'')',
   'if not payroll_v2_can_manage_employees(b,r) or not exists(select 1 from jsonb_array_elements(next_state->''employees'')');
  if patched=definition then raise exception 'Unexpected employee photo authorization; nothing changed';end if;
  execute patched;
 end if;
end $patch$;

create or replace function public.payroll_v2_get_files(b uuid,r uuid,ids text[]) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare access text;
begin
 access:=payroll_v2_role(b,r);if access='none' then raise exception 'Payroll access denied' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',file_id,'dataUrl',data_url,'kind',kind)) from payroll_v2_files where business_id=b and branch_id=r and file_id=any(ids) and (payroll_v2_can_manage_employees(b,r) or kind='pdf')),'[]');
end $$;

-- Keep current Team Access display-name resolution; expose the separate capability.
do $patch$
declare definition text; patched text;
begin
 definition:=pg_get_functiondef('public.payroll_v2_team(uuid,uuid)'::regprocedure);
 if position('''manageEmployees''' in definition)=0 then
  patched:=replace(definition,'''email'',p.email,''level'',coalesce(a.access_level,''none''))',
   '''email'',p.email,''level'',coalesce(a.access_level,''none''),''manageEmployees'',coalesce(a.manage_employees,false) and a.access_level=''edit'')');
  if patched=definition then raise exception 'Unexpected payroll team definition; nothing changed';end if;
  execute patched;
 end if;
end $patch$;

create or replace function public.payroll_v2_grant_employee_management(b uuid,r uuid,member uuid,allowed boolean) returns void
language plpgsql security definer set search_path=public as $$
declare previous boolean; level text;
begin
 if payroll_v2_role(b,r)<>'owner' then raise exception 'Owner access required' using errcode='42501';end if;
 if allowed is null then raise exception 'Choose whether employee management is allowed';end if;
 perform pg_advisory_xact_lock(hashtextextended(b::text||r::text,0));
 select a.manage_employees,a.access_level into previous,level from payroll_v2_access a
  join business_memberships m on m.business_id=a.business_id and m.user_id=a.user_id
  join business_member_branch_access z on z.business_id=a.business_id and z.user_id=a.user_id and z.branch_id=a.branch_id
  where a.business_id=b and a.branch_id=r and a.user_id=member and m.status='active' and m.role<>'owner' for update of a;
 if not found or (allowed and level<>'edit') then raise exception 'Choose an active payroll editor in this branch';end if;
 if previous=allowed then return;end if;
 update payroll_v2_access set manage_employees=allowed,granted_by=auth.uid() where business_id=b and branch_id=r and user_id=member;
 -- Reject already-open redacted worksheets: they must reload before saving.
 update payroll_v2_workspaces set revision=revision+1 where business_id=b and branch_id=r;
 insert into payroll_v2_events(business_id,branch_id,actor_id,action,details) values(b,r,auth.uid(),'employee_management_access',jsonb_build_object('member',member,'before',previous,'allowed',allowed));
end $$;

-- Removing/downgrading payroll access also removes the employee-management grant.
create or replace function public.payroll_v2_grant(b uuid,r uuid,member uuid,level text) returns void
language plpgsql security definer set search_path=public as $$
declare previously_managed boolean;
begin
 if payroll_v2_role(b,r)<>'owner' then raise exception 'Owner access required' using errcode='42501';end if;
 if level is null or level not in ('none','view','edit') or not exists(select 1 from business_memberships m join business_member_branch_access z on z.business_id=m.business_id and z.user_id=m.user_id where m.business_id=b and m.user_id=member and m.status='active' and m.role<>'owner' and z.branch_id=r) then raise exception 'Choose an active branch team member';end if;
 perform pg_advisory_xact_lock(hashtextextended(b::text||r::text,0));
 select manage_employees into previously_managed from payroll_v2_access where business_id=b and branch_id=r and user_id=member for update;
 if level='none' then delete from payroll_v2_access where business_id=b and branch_id=r and user_id=member;
 else insert into payroll_v2_access(business_id,branch_id,user_id,access_level,granted_by,manage_employees) values(b,r,member,level,auth.uid(),false)
  on conflict(business_id,branch_id,user_id) do update set access_level=excluded.access_level,granted_by=excluded.granted_by,manage_employees=case when excluded.access_level='edit' then payroll_v2_access.manage_employees else false end;end if;
 if previously_managed and level<>'edit' then update payroll_v2_workspaces set revision=revision+1 where business_id=b and branch_id=r;end if;
 insert into payroll_v2_events(business_id,branch_id,actor_id,action,details) values(b,r,auth.uid(),'access',jsonb_build_object('member',member,'level',level,'employeeManagementRevoked',coalesce(previously_managed and level<>'edit',false)));
end $$;

revoke all on function public.payroll_v2_can_manage_employees(uuid,uuid) from public,anon,authenticated;
revoke all on function public.payroll_v2_grant_employee_management(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.payroll_v2_grant_employee_management(uuid,uuid,uuid,boolean) to authenticated;
commit;
