15M PAYROLL - ONLINE HANDOFF
Prepared 2026-11-23

Deployment
- Supabase update 077 has been applied and verified in the 15M project.
- Update 087 (45-day receipt safeguards) was applied on 2026-11-25. Before/after
  checks of all payroll workspaces, private files, permissions and event counts
  matched exactly. No real receipt was entered while testing this update.
- Push this repository commit using GitHub Desktop. The normal website deployment
  publishes the new Payroll tab. Sign in with the existing BWC owner account.
- Payroll uses the selected BWC branch and requires an internet connection.
- The old Payroll module remains paused. No old payroll, expense, invoice,
  inventory, or cash records were deleted or imported into the new payroll.

Starting records
- Only the standalone draft's employee profiles and settings were transferred.
- No draft attendance, jobs, amounts, saved worksheets, or payslips were imported.
- The one-time branch-assignment panel has been removed after owner setup.
  Any remaining legacy draft profiles stay preserved privately in the database;
  removing this panel does not delete profiles or change assigned branches.
- Removed employee profiles remain removed.

Access and privacy
- Existing business owners have access. Staff have no new payroll access by default.
- Use Payroll access to grant view-only or payroll-editor access per branch.
- Owners may separately grant Add & manage employees to selected payroll editors
  per branch. This includes private profiles, contact/account details, documents,
  and reversible employee archival/restoration. It is off by default.
- Payroll rules, access grants, full-backup buttons and released-payslip
  corrections remain owner-only. Downgrading payroll access revokes employee
  management. Reopen Payroll after a grant/revocation to reload current details.
- Invoice and PMS pickers read limited employee names/designations. Unmatched
  legacy worker choices remain available so existing workflows are preserved.
- Payslips and ID photos are private database files, not public website assets.
- No personal employee records or account credentials are included in this repository.

Workflow
- Update 087 adds a full retained-balance receipt action. Availability is exactly
  45 calendar days from the actual unit release date, including month/year changes.
  The lower table stays read-only except for the received-status choice once due.
  Payroll editors/owners confirm actual date and full amount received; viewers cannot.
  Unknown contracts must be confirmed before a receipt can be recorded.
- Received balances display zero outstanding, with the original received amount
  and date retained. Receipt confirmation is separate from weekly earnings: no
  money transfer, automatic payment, extra weekly salary, or Expenses entry.
  The server checks Manila dates, current revision, balance and release date;
  it rejects early/future/duplicate receipts and locks the underlying payment basis.
  Ordinary worksheet saves cannot create, edit, remove or overwrite a receipt.
  Corrections require an owner-reviewed audit process, not an editable dropdown.
- New PDF/print references include computed availability and receipts known by
  the payslip payday. Previously released PDF files and snapshots remain unchanged.
- Cutoff: Saturday through Friday. Default payday: following Saturday, editable.
- Painters: edit the table, Save table, then Print, Save as PDF, or Release payslip.
- Unit status replaces the editable Settled before BWC column. Choose Ongoing
  or Released; Released requires the actual unit release date in the same cell.
  The row stays in the release week's main table. Later weeks carry ongoing
  units only; released rows remain read-only references, never new weekly pay.
- Balance and retained units is read-only and lists released units with a
  positive balance (or an unknown balance awaiting an agreed labor price).
  Ongoing and fully paid released units do not appear in that lower table.
  No automatic retention deductions, release-date arithmetic or payouts.
- Existing pre-BWC amounts remain stored and validated, but are no longer
  editable in the normal worksheet. Released payslip snapshots remain locked.
- Apply Supabase update 086 before deploying the simplified release controls.
  It adds validation only; it does not clear/import any employee records.
- Unknown original labor prices: leave Agreed labor blank. Store
  only the actual payment; contract/opening/remaining are null and display
  Pending confirmation in the table, print preview and PDF. Confirming the
  price in a later working week subtracts the previously recorded payments.
  Existing released copies remain unchanged. Apply update 084 before deploying.
- Reviewed historical imports: update 085 provides a private, owner-only queue.
  A compatible client applies the reviewed branch/employee payload on the next
  owner Payroll open, reusing the normal revision, amount, archive and PDF checks.
  A changed branch revision stops the import for review; it never overwrites
  newer payroll. Before-sheets and review notes are retained privately. No
  imports are bundled in this repository, and neither migration stages data.
  Actual received dates are preserved in the released archive and later payment
  references. Historical imports do not transfer money or create Expenses.
- Daily staff: record attendance and late/OT duration; review the calculation and
  confirm release. Overtime is recorded only; no overtime-pay rule is configured.
- A painter's previous amount is a recorded worksheet amount, not independent
  confirmation of payment. Retention dates are references, not automatic payouts.
- Release stores a fixed snapshot. With update 100, PDF generation/upload is no
  longer required to save or release. It does not transfer money or create an
  Expense. Record actual expenditure separately.
- Released Payslips contains employee folders and their released documents.
- Owner correction uses Void / correct with a reason. Existing PDFs and audit
  snapshots are retained; a replacement is issued instead of silently rewriting it.
- Employee deletion means removal from the active list; history is preserved.
- Short payslips use 8.5 x 5.5 inches (half short bond); longer records use full
  short bond / Letter with additional pages as needed. Print opens a read-only
  HTML page, without PDF processing. PDF download remains an optional action.

Storage and limits
- Branch saves use a revision check to prevent one browser overwriting another.
- State and new files save atomically; failed saves are not confirmed as released.
- PDF files use an optimized logo. Files and documents still consume database
  space; monitor the Supabase quota and export owner backups regularly.
- Current guardrails: 8 MB branch JSON state; 15 MB per inline file; 30 new files
  per save. Revisit storage design/archival before these limits are approached.
- The local draft remains separate and is not a backup of later BWC payroll edits.

Verification
- Original public-table row counts and content checksums matched before/after
  the migration and employee import (excluding the new nullable PMS link column).
- Tests cover scoped access, private documents, save conflicts, totals, fixed
  PDF releases, owner corrections, daily locks, and legacy employee preservation.
- Isolated browser tests used fictional employees, never live payroll entries.

Safe rollback
- Hide the new tab or set the new payroll_v2_settings enabled flag to false for
  the 15M business. Preserve all payroll_v2 tables/files for later recovery.
- Do not drop tables, reset other modules, or re-enable the old payroll as a
  rollback shortcut. The old shared worker records are intentionally preserved.

Payroll validation performance (099, applied 2026-11-28)
- Update 099 caches the employee/job agreement variants once per validation,
  replacing a full ledger scan for every worksheet row. It replaces only the
  internal agreement validator; it does not change records or permissions.
- The installer is guarded, repeatable and supports LF and Windows CRLF bodies.
  Manual function-only rollback is in
  supabase/repairs/rollback_099_payroll_agreement_validation_performance.sql.
- The 603-test suite passes, including accepted/rejected input parity, branch
  isolation, repeat installation and exact-definition rollback for both endings.
- Isolated benchmark: tests/benchmarks/payroll-database-save.cjs, using
  BWC_PGLITE_PATH. It uses fictional in-memory data, never the live database.
  Sample whole-save timing improved from 859 ms to 568 ms; this is not a live SLA.
- Live post-install read-only agreement validation completed in 2449.600 ms.
  Both branch state checksums/revisions and file count remained unchanged.
  No real payment was resubmitted to test this deployment. High database CPU
  can still affect end-to-end save latency; do not blindly retry timed-out saves.

Save records first; print on demand (100, 2026-11-28)
- Apply supabase/100_payroll_save_records_print_on_demand.sql before publishing
  the record-print frontend. Only payroll_v2_save/load function definitions change;
  no records, permissions, amounts or existing PDF files are rewritten/deleted.
- The server advertises payrollDocumentMode=record. New clients then save receipt
  and immutable payday snapshots atomically, without PDF rendering/file lookups.
  Older servers retain the PDF-required fallback; older clients still work.
- Preview and Print render the fixed snapshot as HTML. PDF download reuses an old
  saved PDF or generates one on demand, without uploading it or recording payment.
- Tests cover both branches, record-only painter/daily/retained releases, photo
  uploads, permissions, immutable history, conflicts, duplicate receipts and safe
  timeout confirmation. Local browser QA disables the PDF engine deliberately.
- Function-only rollback: supabase/repairs/rollback_100_payroll_record_documents.sql.
  It refuses to restore mandatory PDFs after record-only releases exist. Never
  delete payroll history to force rollback; retain record-mode compatibility.
- Server validation and revision checks remain. This removes PDF work from saves,
  not all possible database/network delays; never blindly retry uncertain saves.
- Live migration verified 2026-11-28: both workspace checksums/revisions and all
  22 existing file contents matched before/after; function permissions unchanged.
  All 611 tests pass. No actual payroll payment was submitted during deployment.

Batch validation cache (101, 2026-11-28)
- Apply supabase/101_payroll_validation_batch_cache.sql after 099. It batches
  cross-date ledger fingerprints once per state instead of rebuilding them for
  every job. All changed-job checks still run; the original fingerprint helper
  remains as a fallback. Agreement helpers receive only contract events when
  that is all they need; unitemized legacy jobs retain their full context.
- Only two internal validators and one private helper change. No data, files,
  public RPC behavior, role settings, timeouts or subscriptions are changed.
- 612 tests pass, including baseline/candidate accepted and rejected input parity,
  exact fingerprint parity, LF/CRLF repeat installation and exact rollback,
  branch-scoped saves, receipts, duplicate/stale saves and locked history.
- Isolated record-only save benchmark: 558 ms before vs 400 ms after (fictional
  1.68 MB history). Local timings are not a live end-to-end latency guarantee.
- Live read-only validation on the same unchanged branch state: eight checks
  totaled 4666.8 ms before vs 1137.4 ms after. Agreements: 2032.3 -> 150.7 ms;
  cross-date: 1769.8 -> 77.3 ms. No actual payment was recorded to benchmark.
- Live post-install checks: all 44 job fingerprints match the old algorithm;
  both branch revisions/state checksums and all 22 file checksums are unchanged.
  Existing validator permissions and the save/load RPC definitions are unchanged.
- Rollback only this optimization with
  supabase/repairs/rollback_101_payroll_validation_batch_cache.sql.
  Never delete receipts or retry an uncertain payment just to test performance.
