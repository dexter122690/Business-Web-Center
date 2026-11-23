-- Payroll access uses the owner-assigned Team Access name for this branch.
-- Display-only: no profiles, logins, grants, employee records or payslips change.
-- Apply after 077. Safe to run again.
begin;

create or replace function public.payroll_v2_team(b uuid,r uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if payroll_v2_role(b,r)<>'owner' then
  raise exception 'Owner access required' using errcode='42501';
 end if;
 return coalesce((
  select jsonb_agg(
   jsonb_build_object('id',m.user_id,
    'name',coalesce(team.full_name,nullif(trim(p.full_name),''),p.email),
    'email',p.email,'level',coalesce(a.access_level,'none'))
   order by lower(coalesce(team.full_name,nullif(trim(p.full_name),''),p.email)),p.email,m.user_id
  )
  from business_memberships m
  join profiles p on p.id=m.user_id
  join business_member_branch_access z
   on z.business_id=m.business_id and z.user_id=m.user_id and z.branch_id=r
  left join payroll_v2_access a
   on a.business_id=m.business_id and a.branch_id=r and a.user_id=m.user_id
  left join lateral (
   select trim(i.full_name) as full_name
   from business_team_invites i
   where i.business_id=m.business_id
    and lower(i.email)=lower(p.email)
    and (i.branch_id=r or i.branch_id is null)
    and i.status in ('approved','accepted')
    and nullif(trim(i.full_name),'') is not null
   order by case when i.branch_id=r then 0 else 1 end,i.created_at desc,i.id
   limit 1
  ) team on true
  where m.business_id=b and m.status='active' and m.role<>'owner'
 ),'[]'::jsonb);
end $$;

revoke all on function public.payroll_v2_team(uuid,uuid) from public,anon;
grant execute on function public.payroll_v2_team(uuid,uuid) to authenticated;

commit;
