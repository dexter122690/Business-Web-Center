-- Save permanent payroll snapshots/receipts first; PDF files are optional output.
-- No workspace, payment, PDF, employee, permission or other module data is changed.
begin;
do $patch$
declare d text; p text;
 painter_check text:=$painter$if not exists(select 1 from payroll_v2_files where business_id=b and branch_id=r and file_id=e->>'id' and kind='pdf') then raise exception 'Generate the PDF before releasing the payslip';end if;$painter$;
 daily_check text:=$daily$if not exists(select 1 from payroll_v2_files where business_id=b and branch_id=r and file_id=e->>'slipId' and kind='pdf') then raise exception 'Generate the PDF before releasing the payslip';end if;$daily$;
begin
 d:=pg_get_functiondef('public.payroll_v2_save(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure);
 if position('100: saved painter/payday snapshot' in d)=0 then
  if position(painter_check in d)=0 or position(daily_check in d)=0
   or position('perform payroll_v2_check_payday(old,next_state,b,r);' in d)=0
   or position('Saved payroll history is read-only.' in d)=0 then
   raise exception 'Unexpected payroll save function. Nothing was changed.';
  end if;
  p:=replace(d,painter_check,'null; /* 100: saved painter/payday snapshot is the permanent record; PDF is optional. */');
  p:=replace(p,daily_check,'null; /* 100: saved daily snapshot is the permanent record; PDF is optional. */');
  -- All amount/date/revision/access/receipt/history checks and immutable-file
  -- checks above remain untouched. Old clients may still submit optional PDFs.
  execute p;
 end if;
 d:=pg_get_functiondef('public.payroll_v2_load(uuid,uuid)'::regprocedure);
 if position($mode$'payrollDocumentMode','record'$mode$ in d)=0 then
  if position($old$return jsonb_build_object('payrollWorkflowVersion',$old$ in d)=0 then
   raise exception 'Unexpected payroll load function. Nothing was changed.';
  end if;
  p:=replace(d,$old$return jsonb_build_object('payrollWorkflowVersion',$old$,
   $new$return jsonb_build_object('payrollDocumentMode','record','payrollWorkflowVersion',$new$);
  execute p;
 end if;
end $patch$;
commit;
