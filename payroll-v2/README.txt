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
