-- Manual function-only rollback. Refuses to restore the old PDF requirement
-- when record-only releases exist; never delete those records to force rollback.
begin;
do $rollback$
declare d text; p text;
 painter_marker text:='null; /* 100: saved painter/payday snapshot is the permanent record; PDF is optional. */';
 daily_marker text:='null; /* 100: saved daily snapshot is the permanent record; PDF is optional. */';
begin
 d:=pg_get_functiondef('public.payroll_v2_save(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure);
 if position(painter_marker in d)>0 then
  if position(daily_marker in d)=0 then raise exception 'Unexpected payroll save function';end if;
  if exists(select 1 from public.payroll_v2_workspaces w cross join lateral (
   select x->>'id' id from jsonb_array_elements(coalesce(w.state->'releasedPainterSlips','[]')||coalesce(w.state->'retainedPaydayCopies','[]')) x
   union all select x->>'slipId' from jsonb_array_elements(coalesce(w.state->'slipReleases','[]')) x
  ) required where not exists(select 1 from public.payroll_v2_files f where f.business_id=w.business_id and f.branch_id=w.branch_id and f.file_id=required.id and f.kind='pdf')) then
   raise exception 'Record-only payslips exist. Keep record mode until their permanent PDFs are safely generated; no records were changed.';
  end if;
  p:=replace(d,painter_marker,$painter$if not exists(select 1 from payroll_v2_files where business_id=b and branch_id=r and file_id=e->>'id' and kind='pdf') then raise exception 'Generate the PDF before releasing the payslip';end if;$painter$);
  p:=replace(p,daily_marker,$daily$if not exists(select 1 from payroll_v2_files where business_id=b and branch_id=r and file_id=e->>'slipId' and kind='pdf') then raise exception 'Generate the PDF before releasing the payslip';end if;$daily$);
  execute p;
 end if;
 d:=pg_get_functiondef('public.payroll_v2_load(uuid,uuid)'::regprocedure);
 p:=replace(d,$new$return jsonb_build_object('payrollDocumentMode','record','payrollWorkflowVersion',$new$,
  $old$return jsonb_build_object('payrollWorkflowVersion',$old$);
 if p<>d then execute p;end if;
end $rollback$;
commit;
