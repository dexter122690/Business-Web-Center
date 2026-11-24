15M PAYROLL - ONLINE HANDOFF
Prepared 2026-11-23

Deployment
- Supabase update 077 has been applied and verified in the 15M project.
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
- Cutoff: Saturday through Friday. Default payday: following Saturday, editable.
- Painters: edit the table, Save table, then Print, Save as PDF, or Release payslip.
- Starting an ongoing/retained unit from the old payroll: choose its first BWC
  week, retain the original agreed labor and enter Settled before BWC once.
  This covers amounts already settled through the Friday before that week.
  It reduces the opening balance only; it is not new salary, an Expense, or a
  new payment. Do not include amounts already recorded in BWC or deduct an
  already-settled cash advance again. Enter only new pay in Amount this week.
- Starting amounts may be corrected in the first working week before another
  week or a released payslip exists. Afterwards they stay locked. Historical
  rows whose balances are used by later worksheets cannot be silently changed.
  Existing records without opening amounts continue unchanged.
- Supabase update 083 adds server checks for these optional starting balances.
  It does not create/delete payroll records, import old payslips or change roles.
- Unknown original labor prices: select Agreed price not yet confirmed. Store
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
- Release stores an original PDF and a fixed snapshot together. It does not
  transfer money or create an Expense. Record actual expenditure separately.
- Released Payslips contains employee folders and their released documents.
- Owner correction uses Void / correct with a reason. The original PDF and audit
  snapshot are retained; a replacement is issued instead of silently rewriting it.
- Employee deletion means removal from the active list; history is preserved.
- PDF page size is 8.5 x 5.5 inches (half short bond). Long records continue on
  additional half sheets rather than truncating rows. Print uses the PDF viewer.

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
