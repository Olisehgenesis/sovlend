# Loan Parity Roadmap for SovLend

Date: 2026-09-02
Goal: close the loan-feature gap with legacy iLend and achieve production-grade lending operations.

## 1) Executive Gap View
Current state from mapped evidence:
- Core lending engine exists: application, approval, disbursement, repayment, schedule, allocations, accounting postings, audit/outbox.
- Major servicing parity gaps remain in loan-level UI and workflows.

Estimated parity coverage today:
- Data and core transaction engine: strong
- Legacy loan-operation surface parity: low
- Overall parity against observed legacy loan operations: approximately 5-10%

## 2) Target Capability Set
The target includes all legacy-critical loan functionality plus SovLend controls.

### A. Loan visibility and drill-down
- Active loans register with filters, pagination, export
- Full loan account header with balance and arrears figures
- Complete component breakup: principal, interest, fees, penalties
- Register row click-through from list to account details

### B. Loan servicing tabs
- Account Detail
- Repayment Schedule
- Transactions
- Charges
- Overdue Charges
- Loan Documents
- Notes
- Loan Collateral

### C. Loan actions
- Make repayment
- Add loan charge
- Undo disbursal (controlled reversal)
- Prepay loan
- Foreclosure
- Write-off and recovery

### D. Controls and governance
- Maker-checker separation
- Office scope and approval limits
- Full audit events and immutable ledger trails
- Idempotent external command handling

## 3) What Already Exists (Do Not Rebuild)
- Application creation API and screen
- Checker approval API and screen
- Disbursement API with schedule generation and journal posting
- Repayment API with deterministic allocation order and journal posting
- Arrears classifier job and reminders infrastructure
- Loan export endpoint
- Permission codes for close/write-off/reverse already defined

## 4) Workstreams and Deliverables

### Workstream 1: Loan tab parity UI
Deliverables:
- Add loan tabs to SovLend loan account page:
  - Charges tab (loan-scoped charges)
  - Overdue Charges tab
  - Loan Documents tab
  - Notes tab
  - Collateral tab
- Preserve current schedule and transactions tabs; align labels and table density.

Primary files:
- src/app/(app)/loans/[id]/page.tsx
- New components under src/components for loan tabs
- Supporting styles in src/app/globals.css

Acceptance:
- All tabs render with real data for individual and group loans.
- Empty states are explicit and action-oriented.

### Workstream 1B: Active-loans register parity
Deliverables:
- Unified free-text filter matching legacy operator behavior (name/client/staff/office)
- Numbered pagination controls (first/prev/next/last)
- Dense table row style with direct row click-through to loan detail
- Export-to-document action preserving current CSV as minimum fallback

Primary files:
- src/app/(app)/loans/page.tsx
- Supporting query helpers under src/modules/lending and/or reporting

Acceptance:
- Operator can search active loans with one box and page through results.
- Row click takes user directly to the selected loan account.

### Workstream 2: Loan-scoped charges and overdue charges
Deliverables:
- Add loan-level charge entity support in API layer.
- Show due/paid/waived/outstanding by charge in dedicated tabs.
- Add action to post/add a charge against a loan.

Data model changes:
- Extend existing Charge usage to support strict loan linkage and charge lifecycle metadata (if not already adequate).

APIs to add:
- GET/POST /api/loans/[id]/charges
- PATCH /api/loans/[id]/charges/[chargeId]

Acceptance:
- A loan charge appears in both loan charge tab and overdue calculations when due date is past.

### Workstream 3: Loan documents and notes parity
Deliverables:
- Loan Documents tab: upload/list/delete metadata (no destructive physical delete unless policy allows)
- Notes tab: add/list notes with creator/time

Data model changes:
- Add LoanNote model if keeping client notes separate; or establish typed note strategy.

APIs to add:
- GET/POST /api/loans/[id]/notes
- GET/POST/DELETE /api/loans/[id]/documents

Acceptance:
- New document and note persist and appear immediately.
- Access obeys office scope and permission.

### Workstream 4: Collateral model and workflows
Deliverables:
- Loan Collateral tab parity
- Add collateral capture, valuation, status, optional document attachment links

Data model additions:
- LoanCollateral (loanId, type, description, estimatedValueMinor, valuationDate, status, metadata)
- Optional collateral-document junction if one document supports multiple collateral items

APIs to add:
- GET/POST /api/loans/[id]/collateral
- PATCH/DELETE /api/loans/[id]/collateral/[collateralId]

Acceptance:
- Collateral rows tracked by loan and visible in UI.

### Workstream 5: Undo disbursal, prepay, foreclosure, reversals
Deliverables:
- Undo disbursal controlled reversal flow
- Prepay loan workflow with payoff computation
- Foreclosure closure workflow
- Transaction reversal primitives with immutable reverse entries

Data/service changes:
- Add reversal services in src/modules/lending/application
- Ensure ledger reversals are linked, balanced, and auditable

APIs to add:
- POST /api/loans/[id]/undo-disbursal
- POST /api/loans/[id]/prepay
- POST /api/loans/[id]/foreclose
- POST /api/loans/[id]/transactions/[txnId]/reverse

Acceptance:
- No mutation of original posted rows; only linked reversals.
- Maker-checker and permission checks enforced.

### Workstream 6: Group loan behavior and role separation
Deliverables:
- Ensure group-loan records and displays are first-class in all tabs/actions.
- Validate member context and liability display strategy.

Acceptance:
- Group loan examples (like legacy 1042 pattern) are fully serviceable in SovLend.

### Workstream 7: Full-fidelity loan export (all data)
Deliverables:
- Replace summary-only export with complete loan export package.
- Support single-loan, filtered multi-loan, and full-portfolio exports.
- Include schedule, transactions, allocations, charges, overdue, documents, notes, collateral, accounting, audit, reminders.
- Provide CSV zip package and JSON package.

APIs to add:
- GET /api/loans/export?scope=summary (keep existing behavior for backward compatibility)
- POST /api/loans/export/jobs
  - body supports: loanId/accountNumber, filters, format (csv_zip|json), asOfDate
- GET /api/loans/export/jobs/[jobId]
  - returns: queued/running/succeeded/failed, progress, download metadata
- GET /api/loans/export/jobs/[jobId]/download

Data contract:
- Export manifest with tenant, actor, generatedAt, asOfDate, filters, row counts by file
- Stable keys for joins across CSV files
- Versioned schema for JSON payload

Operational behavior:
- Async export via queue for large datasets
- Idempotent job creation using request hash
- Signed download URLs with short TTL when stored externally

Acceptance:
- Auditor can reconstruct one full loan lifecycle from export files only.
- Operations can export all active loans with schedules and payments in one job.

## 5) Proposed Delivery Phases

### Phase 1 (Immediate parity foundation)
- Active-loans register parity (filter + pagination + row click-through + export UX)
- Loan tabs: Charges, Loan Documents, Notes
- Loan charge APIs and UI
- Loan notes/documents APIs and UI

Exit criteria:
- Users can see and operate on charges/documents/notes at loan level.

### Phase 2 (Servicing parity)
- Overdue Charges tab and overdue aggregation
- Collateral data model + tab
- Group loan display hardening

Exit criteria:
- Loan detail resembles legacy operational breadth for daily servicing.

### Phase 3 (High-risk actions)
- Undo disbursal
- Prepay
- Foreclosure
- Transaction reversals

Exit criteria:
- Controlled high-impact operations available with maker-checker and full audit.

### Phase 4 (Hardening)
- Advanced reporting, reconciliation checks, and error analytics
- Regression tests and role-matrix tests
- Performance and pagination improvements
- Full-fidelity loan export jobs, manifests, and download pipeline

## 6) Schema Change Plan

### Likely additions
- LoanNote
- LoanCollateral
- Optional charge subtype/lifecycle fields if needed for overdue handling parity

### Indexes
- Loan notes by loanId + createdAt desc
- Collateral by loanId + status
- Charges by loanId + dueOn + status

### Migration approach
- Add new tables nullable-safe first
- Backfill where required
- Add strict constraints only after backfill verified

## 7) API Contract Plan
All mutating endpoints must include:
- Auth session check
- Office scope validation
- Permission check with AuthorizationService
- Idempotency for external-facing financial commands
- AuditEvent and OutboxEvent append

Error conventions:
- 401 unauthenticated
- 403 forbidden or out-of-scope
- 404 aggregate not found
- 400 validation/state transition failure

## 8) Testing Strategy

### Unit tests
- Charge overdue computations
- Foreclosure and prepay payoff logic
- Reversal balancing and status transitions
- Collateral validation

### Integration tests
- End-to-end flow: apply -> approve -> disburse -> charge -> repay -> close
- Group loan servicing flow
- Permission matrix (teller vs manager vs auditor)
- Export job flow: create -> process -> download for single and bulk scopes

### Regression tests
- Ensure existing disbursement and repayment behavior remains unchanged
- Ensure allocation order remains penalties -> fees -> interest -> principal
- Ensure export datasets reconcile totals with on-screen balances and journals

## 9) Operational Risks and Mitigations
- Risk: introducing mutable behavior into immutable financial flows
  - Mitigation: reverse entries only; no update/delete on posted events
- Risk: parity rush causing auth bypasses
  - Mitigation: centralized authorization checks in every endpoint
- Risk: data drift between schedule and transactions
  - Mitigation: transactional updates with serializable isolation for financial writes

## 10) Definition of Done for "Loan Parity"
SovLend is considered parity-ready when:
- Loan detail supports all major legacy tabs and key actions
- Individual and group loans are fully operable
- High-risk actions are maker-checker protected and fully auditable
- All loan financial postings remain immutable and balanced
- Test suite covers core and high-risk loan operations

## 11) Build Order Recommendation
1. Loan-scoped Charges + Overdue Charges
2. Loan Documents + Notes
3. Collateral
4. Undo Disbursal + Reversal primitives
5. Prepay + Foreclosure
6. Group-loan UX and reporting polish
7. Full-fidelity loan export package and async jobs

This order gives fast operational parity while protecting financial correctness.
