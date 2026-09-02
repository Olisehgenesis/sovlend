# Loan Data and Functionality Reference

Date: 2026-09-02
Tenant observed: jumpstart

## Scope
This document captures:
- Legacy iLend loan data visible in the live UI (active loans and loan account detail pages).
- SovLend loan data model and functionality implemented in this repository.
- Loan lifecycle, schedule/allocation behavior, transactions, and dependencies on products/accounting.

Implementation roadmap: see docs/loan-parity-roadmap.md.

## Sources Used
- Legacy pages inspected with Playwright:
  - https://ilendloans.net/?tenantIdentifier=jumpstart#/account/activeloans
  - https://ilendloans.net/?tenantIdentifier=jumpstart#/viewloanaccount/1042
  - https://ilendloans.net/?tenantIdentifier=jumpstart#/viewloanaccount/813
- SovLend code:
  - prisma/schema.prisma
  - src/app/(app)/loans/page.tsx
  - src/app/(app)/loans/new/page.tsx
  - src/app/(app)/loans/applications/[id]/page.tsx
  - src/app/(app)/loans/[id]/page.tsx
  - src/app/api/loan-applications/route.ts
  - src/app/api/loan-applications/[id]/approve/route.ts
  - src/app/api/loans/[id]/disburse/route.ts
  - src/app/api/loans/[id]/repayments/route.ts
  - src/app/api/loans/export/route.ts
  - src/modules/lending/application/approve-loan-application.ts
  - src/modules/lending/application/disburse-loan.ts
  - src/modules/lending/application/post-repayment.ts
  - src/modules/lending/domain/repayment-schedule.ts
  - src/modules/lending/domain/repayment-allocation.ts
  - src/migration/import-loans.ts

## Legacy iLend: Loan Surfaces Observed

### 1) Active Loans List
Observed columns:
- Account Holder's Name
- Account ID
- Loan Name
- Status
- Loan Amount
- Business Development Officer
- Principal Due
- Interest Due
- Total Due
- Total Paid

Observed list controls and behaviors:
- Free-text filter input with placeholder: Filter display by name/client/staff/office
- Export action: Export To Document
- Pagination controls: «, ‹, page numbers, ›, »
- Multi-page dataset (observed at least 8 pages)
- Row click-through behavior to open a loan account detail view

Observed loan types in list:
- GROUP LOAN PRODUCT
- 30 WEEK LOAN
- PERSONAL LOAN
- Micro-Enterprise Loan - Monthly
- BUSINESS WEEKLY LOAN
- 40 WEEK LOAN

### 2) Loan Account Page Tabs
Observed tabs:
- Account Detail
- Repayment Schedule
- Transactions
- Loan Collateral
- Overdue Charges
- Charges
- Loan Documents
- Notes

Observed actions on loan page:
- Add Loan Charge
- Prepay Loan
- Foreclosure
- Make Repayment
- Undo Disbursal
- More

### 3) Loan Header and Summary Data (Observed)
- Loan name and account number
- Current Balance
- Arrears By
- Breakdown table by component:
  - Principal: Original, Paid, Waived, Written Off, Outstanding, Over Due
  - Interest: Original, Paid, Waived, Written Off, Outstanding, Over Due
  - Fees: Original, Paid, Waived, Written Off, Outstanding, Over Due
  - Penalties: Original, Paid, Waived, Written Off, Outstanding, Over Due
  - Total: Original, Paid, Waived, Written Off, Outstanding, Over Due

### 4) Loan Detail Fields (Observed)
- Disbursement Date
- Loan Purpose
- Loan Officer
- Currency
- External Id
- Proposed Amount
- Approved Amount
- Disburse Amount
- Performance History
- # of Repayments
- Maturity Date

### 5) Terms / Product Behavior Fields (Observed)
- Repayment Strategy
- Repayments (count and frequency)
- Amortization
- Equal Amortization
- Interest (rate and method, e.g., Flat)
- Grace: On Principal Payment
- Grace: On Interest Payment
- Grace on Arrears Ageing
- Fund Source
- Interest Free Period
- Interest Calculation Period
- Allow Partial Interest Calculation with same as repayment
- Interest Type
- Submitted on
- Approved on
- Disbursed on
- Matures on
- Recalculate Interest
- Days in year
- Days in month

### 6) Example Loans Observed
- Loan 813 (individual): 30 WEEK LOAN, in arrears, rich penalties/fees exposure.
- Loan 1042 (group): GROUP LOAN PRODUCT, in arrears, includes fund source and standard tab set.

## SovLend: Implemented Loan Data Model

### Core statuses
- LoanApplicationStatus: DRAFT, SUBMITTED, APPROVED, REJECTED, WITHDRAWN, DISBURSED
- LoanStatus: APPROVED, ACTIVE, IN_ARREARS, OVERPAID, WRITTEN_OFF, CLOSED

### LoanProduct fields
- id, organizationId, name, shortName
- denominationCurrency
- principalMinMinor, principalMaxMinor
- annualRateBps
- repaymentCount
- repaymentFrequency (e.g., 1 WEEKS)
- amortizationMethod
- interestMethod
- lateFeeRule (JSON)
- version, active

### LoanApplication fields
- id, submittedById
- clientId (optional), groupId (optional — exactly one of clientId/groupId required, DB `CHECK` constraint), officeId, productId
- proposedPrincipalMinor
- approvedPrincipalMinor
- status
- purpose
- submittedAt, approvedAt
- relations: approvals, loan, client, group, office, product

### Loan fields
- id, applicationId (unique)
- clientId (optional), groupId (optional — exactly one of clientId/groupId required, DB `CHECK` constraint), productId, officeId, loanOfficerId
- accountNumber (unique)
- denominationCurrency
- principalMinor
- termsSnapshot (JSON)
- scheduleVersion
- status
- disbursedOn, maturesOn
- relations: installments, transactions, documents, reminders

### LoanInstallment fields
- loanId, installmentNumber, dueOn
- due buckets: principalDueMinor, interestDueMinor, feesDueMinor, penaltiesDueMinor
- paid buckets: principalPaidMinor, interestPaidMinor, feesPaidMinor, penaltiesPaidMinor
- waived buckets: principalWaivedMinor, interestWaivedMinor, feesWaivedMinor, penaltiesWaivedMinor (set by Prepay/Foreclosure servicing actions)

### LoanTransaction fields
- loanId
- transactionType
- businessDate
- settlementCurrency, settlementChannel
- settlementAccountId
- settlementAmountMinor
- denominationAmountMinor
- priceSnapshotId
- externalReference
- idempotencyKey (unique)
- reversedById (for reversal linkage)

### LoanTransactionAllocation fields
- transactionId, installmentId
- principalMinor, interestMinor, feesMinor, penaltiesMinor

### LoanServiceRequest fields (Agent 5: high-risk servicing, maker-checker)
- loanId, actionType (UNDO_DISBURSAL, PREPAY, FORECLOSURE, TRANSACTION_REVERSAL)
- status (PENDING, APPROVED, REJECTED), reason, payload (JSON, captured at request time)
- idempotencyKey (unique)
- requestedById, requestedAt, decidedById, decidedAt, decisionNote
- resultTransactionId (unique, links to the LoanTransaction created on approval)
- only one PENDING request per loan is allowed at a time; the decider must differ from the requester

### Other loan-related entities
- Document (loanId relation)
- Reminder (loanId + installmentId, type/status/scheduledFor/attempts)
- Journal and JournalLine entries posted for disbursement and repayment
- LoanProductAccountingMapping required for posting to ledger accounts

## SovLend: Implemented Loan Lifecycle and Rules

### Lifecycle stages in UI
- Application -> Approval -> Disbursement -> Repayment -> Closure

### Application
- Endpoint: POST /api/loan-applications
- Requires:
  - Authenticated user with permission
  - Active client in caller's office scope
  - Active loan product
  - Principal within product min/max
- Records audit event and outbox event

### Approval (maker-checker)
- Endpoint: POST /api/loan-applications/[id]/approve
- Rules:
  - Only SUBMITTED applications can be approved
  - Submitter cannot approve own application
  - Approved principal must be > 0 and in product range
  - Approval permission and limits enforced
- Effects:
  - Application status -> APPROVED
  - Loan account record created
  - Terms snapshot captured from product
  - Audit + outbox recorded

### Disbursement (maker-checker separation)
- Endpoint: POST /api/loans/[id]/disburse
- Rules:
  - Loan must be APPROVED and not yet disbursed
  - UGX-only currently
  - Submitter/approver cannot disburse same loan
  - Product accounting mapping must exist
  - Settlement account must be active and matching org/currency
- Effects:
  - Loan status -> ACTIVE
  - disbursedOn and maturesOn set
  - Installment schedule generated and saved
  - DISBURSEMENT transaction created
  - Journal posted (Dr principal receivable, Cr settlement account)
  - Audit + outbox recorded

### Repayment
- Endpoint: POST /api/loans/[id]/repayments
- Rules:
  - Loan must be ACTIVE, IN_ARREARS, or OVERPAID
  - Amount must be positive
  - UGX-only currently
  - Settlement account and mappings required
- Allocation order:
  - Penalties -> Fees -> Interest -> Principal
  - Oldest due installments first (due date, then installment number)
- Effects:
  - Installment paid buckets incremented
  - Allocation rows recorded
  - REPAYMENT transaction created
  - Journal posted (Dr settlement, Cr principal/interest/fee/penalty/overpayment)
  - Status transitions:
    - OVERPAID when extra remains
    - CLOSED when fully cleared
    - IN_ARREARS -> ACTIVE if overdue cleared
  - Audit + outbox recorded

## SovLend UI Coverage (Current)

### Loan list page
- Applications and linked loan accounts in one table
- Product catalog summary table
- CSV export
- New application flow

### Loan application review page
- Summary details (borrower, office, product, proposed amount, purpose, submitter)
- Approval form when eligible
- Disbursement form after approval when eligible
- Maker-checker guidance states

### Loan account page
- Summary metrics:
  - Status
  - Principal
  - Total scheduled
  - Outstanding
- Repayment form (for ACTIVE/IN_ARREARS/OVERPAID)
- Repayment schedule table
- Transactions table

## Legacy -> SovLend Data Mapping Notes
- Legacy principal/interest/fees/penalties split maps naturally to installment due/paid buckets.
- Legacy schedule periods map to LoanInstallment rows.
- Legacy transaction history maps to LoanTransaction rows.
- Legacy imports are read-only historical records; import does not replay historical journal entries.
- Imported historical loan account numbers use LEGACY-<loanId> format.

## Gaps Between Legacy Surface and Current SovLend Surface
Legacy shows broader per-loan tabs than current SovLend loan page:
- Not yet surfaced in SovLend loan UI:
  - None remaining for high-risk servicing actions (Undo Disbursal, Foreclosure, Prepay Loan are now available under the "Servicing" tab, maker-checker controlled)
- Not yet surfaced in SovLend loan register:
  - Export-to-document action matching legacy operator flow
- Partially present elsewhere:
  - Overdue charges view currently covers charge-level overdue items; installment penalty parity still needs expansion

## Practical Data Checklist for a Complete Loan Record
For product + origination:
- Borrower identity, office, officer
- Product config snapshot (rate, frequency, count, methods)
- Requested and approved principal, purpose
- Submission/approval timestamps and actors

For account state:
- Current status and lifecycle dates
- Currency and account number
- Component balances: principal/interest/fees/penalties (due, paid, outstanding, overdue)

For schedule:
- Installment number, due date
- Due buckets and paid buckets by component
- Outstanding per installment

For transactions:
- Type, date, amount
- Channel/settlement account
- External reference/receipt
- Allocation split to components
- Idempotency and reversal linkage

For accounting/audit:
- Product mappings to ledger accounts
- Journal entries and posting status
- Audit trail entries and outbox events

For communication/control:
- Reminders tied to installments
- Documents and notes
- Permissions and approval limits

## Which Features Exist Where

### Feature parity matrix
- Active loans register table: Legacy yes, SovLend yes
- Active loans register filter (name/client/staff/office): Legacy yes, SovLend yes
- Active loans register pagination: Legacy yes, SovLend yes
- Active loans register export-to-document flow: Legacy yes, SovLend partial (CSV export exists)
- Active loans row click-through interaction: Legacy yes, SovLend yes
- Group and individual loan visibility: Legacy yes, SovLend yes (Loan/LoanApplication can be owned by either a Client or a Group — added 2026-09-03, see `prisma/migrations/20260903030000_group_owned_loans/`)
- Loan application capture: Legacy yes, SovLend yes
- Maker-checker approval: Legacy yes, SovLend yes
- Maker-checker disbursement separation: Legacy yes, SovLend yes
- Loan schedule display: Legacy yes, SovLend yes
- Repayment posting: Legacy yes, SovLend yes
- Repayment allocation by component: Legacy yes, SovLend yes
- Charges shown on loan page: Legacy yes, SovLend yes
- Loan documents tab: Legacy yes, SovLend yes
- Loan notes tab: Legacy yes, SovLend yes
- Loan collateral tab: Legacy yes, SovLend yes
- Overdue charges tab: Legacy yes, SovLend partial
- Prepay loan action: Legacy yes, SovLend yes (maker-checker, Servicing tab)
- Foreclosure action: Legacy yes, SovLend yes (maker-checker, Servicing tab)
- Undo disbursal action: Legacy yes, SovLend yes (maker-checker, Servicing tab, only while no repayments posted)
- Transaction reversal action: Legacy yes, SovLend yes (maker-checker, repayment transactions only)
- Loan export: Legacy yes, SovLend yes (CSV)

### Live examples captured
- Individual loan sample captured from legacy: 813 (30 WEEK LOAN)
- Group loan sample captured from legacy: 1042 (GROUP LOAN PRODUCT)
- Active-loans listing captured with multiple product types and statuses

## SovLend Loan System Map By File

### Data model
- prisma/schema.prisma
  - LoanProduct, LoanApplication, Loan, LoanInstallment, LoanTransaction, LoanTransactionAllocation
  - Reminder, Document, Journal, JournalLine, SettlementAccount, LoanProductAccountingMapping

### Loan pages
- src/app/(app)/loans/page.tsx
  - Loan/application registry, product summary, CSV export entrypoint
- src/app/(app)/loans/new/page.tsx
  - New application screen with client search and product selection
- src/app/(app)/loans/applications/[id]/page.tsx
  - Application review screen with approval/disbursement states
- src/app/(app)/loans/[id]/page.tsx
  - Loan account servicing view: metrics, repayment form, schedule, transactions
- src/app/(app)/loans/layout.tsx
  - Lifecycle workflow strip wrapper

### Loan APIs
- src/app/api/loan-applications/route.ts
  - Create submitted application
- src/app/api/loan-applications/[id]/approve/route.ts
  - Checker approval endpoint
- src/app/api/loans/[id]/disburse/route.ts
  - Disbursement endpoint
- src/app/api/loans/[id]/repayments/route.ts
  - Repayment endpoint
- src/app/api/loans/export/route.ts
  - CSV export endpoint

### Loan domain/application services
- src/modules/lending/application/approve-loan-application.ts
  - Maker-checker approval, loan account creation, terms snapshot, audit/outbox
- src/modules/lending/application/disburse-loan.ts
  - Disbursement guardrails, schedule creation, journal posting, audit/outbox
- src/modules/lending/application/post-repayment.ts
  - Repayment posting, component allocation persistence, journal posting, status transitions
- src/modules/lending/domain/repayment-schedule.ts
  - Flat and declining schedule math and due-date cadence
- src/modules/lending/domain/repayment-allocation.ts
  - Penalties -> Fees -> Interest -> Principal allocation order

### Migration and historical imports
- src/migration/import-loans.ts
  - Imports legacy loan schedule + transactions as historical read-only records

## Loan System Boundaries and Constraints
- Currency: live servicing currently enforces UGX for disbursement and repayments.
- Idempotency: disbursement and repayment require idempotency keys.
- Permissions: loan apply/approve/disburse/repay/export each pass authorization checks.
- Office scope: user office scope filters loan visibility and actions.
- Accounting readiness: disbursement/repayment requires product accounting mappings and valid settlement account.
- Auditability: major loan actions emit audit and outbox records.

## Model and Route Existence Audit

### Models that exist now
- Loan core: Loan, LoanApplication, LoanProduct, LoanInstallment, LoanTransaction, LoanTransactionAllocation
- Related data: Charge, ChargeDefinition, Document, Reminder, Journal, JournalLine, SettlementAccount, LoanProductAccountingMapping
- Loan parity additions: LoanNote, LoanCollateral, loan-scoped Charge relation (Charge.loanId)

### Models missing for full legacy parity
- No additional loan-core model gaps for current parity phases

### Routes that exist now
- POST /api/loan-applications
- POST /api/loan-applications/[id]/approve
- POST /api/loans/[id]/disburse
- POST /api/loans/[id]/repayments
- GET /api/loans/export
- Full-fidelity export (Agent 6): GET/POST /api/loans/export-jobs, GET /api/loans/export-jobs/[jobId], GET /api/loans/export-jobs/[jobId]/download
- Loan charges: GET/POST /api/loans/[id]/charges and PATCH /api/loans/[id]/charges/[chargeId]
- Loan notes: GET/POST /api/loans/[id]/notes
- Loan documents: GET/POST /api/loans/[id]/documents and DELETE /api/loans/[id]/documents/[documentId]
- Loan collateral: GET/POST /api/loans/[id]/collateral and PATCH/DELETE /api/loans/[id]/collateral/[collateralId]
- High-impact servicing (maker-checker): GET/POST /api/loans/[id]/service-actions, POST /api/loans/[id]/service-actions/[requestId]/decision, GET /api/loans/[id]/payoff-quote

### Routes missing for full legacy parity
- None remaining for the six-track parity plan; all six agents (1-6) are complete.

### Active-loans register parity gaps from legacy sample
- Missing unified register filter by name/client/staff/office
- Missing numbered pagination controls and page navigation
- Missing export-to-document style flow (current export is CSV summary)
- Missing dense row click-through behavior parity

## Export Requirement (Must Have)

Export must support full extraction for any one loan and bulk extraction for all loans, including all child records needed for audit, operations, and migration checks.

### Required export scopes
- Single-loan complete export by loan account number or internal ID
- Multi-loan filtered export (status, office, product, date range, officer, arrears state)
- Full portfolio export (all loans in authorized scope)

### Required datasets per loan
- Loan master: account number, client, office, product snapshot, status, lifecycle dates, officer, external references
- Loan balances: principal/interest/fees/penalties totals for original, paid, waived, written-off, outstanding, overdue
- Repayment schedule: installment-level due and paid component buckets, outstanding per installment, due dates
- Transactions: disbursement, repayments, reversals, references, channels, settlement accounts, amounts, business dates
- Allocation lines: transaction-to-installment allocations by component
- Charges: charge definitions and loan-applied charges, due dates, status, paid/waived/outstanding
- Overdue view: overdue installments and overdue charges as-of export date
- Documents: document metadata (name, type, sha256, createdAt, storage key or signed URL policy)
- Notes: note text, author, createdAt
- Collateral: type, value, status, valuation date, supporting docs
- Accounting: journal references and line-level debit/credit entries tied to loan events
- Audit: action trail for application, approval, disbursement, repayment, status changes, reversals
- Reminder/notification trail: repayment reminders and delivery status

### Export formats
- CSV package (zip): one CSV per dataset with shared keys
- JSON package: canonical nested structure for integrations
- Optional printable statement/PDF for customer-facing use

### Minimum file set for CSV package
- loans.csv
- loan_balances.csv
- loan_schedule.csv
- loan_transactions.csv
- loan_transaction_allocations.csv
- loan_charges.csv
- loan_overdue_snapshot.csv
- loan_documents.csv
- loan_notes.csv
- loan_collateral.csv
- loan_journals.csv
- loan_journal_lines.csv
- loan_audit_events.csv
- loan_reminders.csv

### Export quality rules
- Deterministic numeric formatting and currency codes
- Export timestamp and as-of date included in manifest
- Office-scope and permission enforcement on every export
- Large exports processed asynchronously with job status and retry
- Idempotent export job keys for repeated requests

### Current SovLend export gap
- Resolved by Agent 6: async export job API (`LoanExportJob`) supports SINGLE_LOAN/FILTERED/PORTFOLIO scopes, CSV zip (all 13 datasets above) and nested JSON package formats, manifest with as-of date/scope/per-dataset counts, idempotency keys, office-scope + permission enforcement, and async processing via BullMQ worker. UI at `/loans/exports`.
