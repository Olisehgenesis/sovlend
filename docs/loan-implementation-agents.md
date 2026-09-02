# Loan Implementation Agents (6-Track Execution)

Date: 2026-09-02
Purpose: execute loan parity in ordered tracks, one by one.

## Delivery Status
- Agent 1: Completed
- Agent 2: Completed
- Agent 3: Completed
- Agent 4: Completed
- Agent 5: Completed
- Agent 6: Not started

## Agent 1: Active-Loans Register Parity
Scope:
- Add unified filter for name/client/staff/office.
- Add numbered pagination with first/prev/next/last.
- Add row click-through behavior to loan detail.
- Improve export UX alignment with legacy list screen.

Deliverables:
- Updated loan list query + paging contract.
- Updated loan list UI with filter/pagination.
- Export action visible from list header.

Definition of done:
- Legacy-style operator workflow for finding and opening loans is reproduced.

## Agent 2: Loan Charges and Overdue Charges
Scope:
- Add loan-scoped charges API and UI.
- Add overdue charges computations and tab.
- Show due/paid/waived/outstanding per charge.

Deliverables:
- Loan charge routes and validations.
- Charges tab and overdue charges tab in loan page.
- Tests for overdue calculations.

Definition of done:
- Operators can post and monitor charges directly at loan level.

## Agent 3: Loan Documents and Loan Notes
Scope:
- Add loan-specific notes and document management.
- Support metadata-safe document lifecycle.

Deliverables:
- Loan notes endpoints and UI tab.
- Loan documents endpoints and UI tab.
- Access scope and permission checks.

Definition of done:
- Loan-level evidence trail (notes/docs) is complete and searchable.

## Agent 4: Loan Collateral
Scope:
- Add collateral model, endpoints, and tab.
- Support valuation, status, and linked evidence.

Deliverables:
- Prisma model + migration for collateral.
- Collateral CRUD routes.
- Loan collateral tab with list/forms.

Definition of done:
- Every secured loan can store and show collateral details.

## Agent 5: High-Risk Servicing Actions
Scope:
- Undo disbursal with controlled reversal.
- Prepay workflow with payoff calculation.
- Foreclosure workflow.
- Transaction reversal endpoint and policy.

Deliverables:
- Domain services for reversals/prepay/foreclosure.
- APIs with maker-checker and permission controls.
- Immutable accounting-safe reverse entries.

Definition of done:
- High-impact actions are possible without breaking financial invariants.

Status: Completed.
- `LoanServiceRequest` model added (propose → separate-actor decide → atomic execution), enforcing exactly one PENDING request per loan.
- Domain function `calculateLoanPayoff` computes principal/interest/fees/penalties payoff (collected vs waived) on a cash-basis accounting model — no reversing entries are needed for interest/penalties never booked, only principal (always booked in full at disbursement) is guaranteed fully collected.
- Application service `loan-service-actions.ts` implements: `requestLoanServiceAction`, `decideLoanServiceAction`, `previewLoanPayoff`, and executors for Undo Disbursal, full settlement (Prepay/Foreclosure), and Transaction Reversal (repayments only; disbursement reversal goes through Undo Disbursal instead).
- Undo Disbursal is only permitted while the loan is ACTIVE with no transactions besides the original disbursement (guarantees safe schedule deletion); reverses the disbursement journal Dr/Cr and resets the loan to APPROVED.
- Foreclosure always forces `waivePenalties = true`; Prepay allows an operator-chosen `waivePenalties` flag. Both close the loan and reuse `calculateLoanPayoff`.
- Transaction Reversal decrements installment paid buckets per original allocation and recomputes loan status, allowing a CLOSED/overpaid loan to reopen if reversal creates a new balance.
- New API routes: `POST/GET /api/loans/[id]/service-actions`, `POST /api/loans/[id]/service-actions/[requestId]/decision`, `GET /api/loans/[id]/payoff-quote`.
- New `permissions.loanReverse` check (assigned to the Branch Manager default group) gates request and decision; maker-checker enforced by rejecting a decision from the same user who made the request.
- New "Servicing" tab added to the loan detail page (`loan-service-actions-panel.tsx`) with a request form (live payoff preview) and an approve/reject history list.
- `LoanInstallment` gained `principalWaivedMinor`/`interestWaivedMinor`/`feesWaivedMinor`/`penaltiesWaivedMinor` columns to record the Waived bucket from the legacy parity breakdown.
- New unit tests: `loan-payoff.test.ts` (4 tests covering mixed past/future installments, waive-penalties policy, partial prior payments, fully-settled installments).

## Agent 6: Full-Fidelity Loan Export
Scope:
- Export all loan data for one loan, filtered sets, and full portfolio.
- Include schedule, payments, charges, docs, notes, collateral, accounting, audit, reminders.

Deliverables:
- Async export job API.
- CSV zip and JSON export package.
- Export manifest with counts, as-of date, and scope metadata.

Definition of done:
- Auditor can reconstruct any loan lifecycle from export package only.

## Execution Order
1. Agent 1
2. Agent 2
3. Agent 3
4. Agent 4
5. Agent 5
6. Agent 6

## Current Baseline Check
- Core loan engine models exist.
- Core application/approval/disbursement/repayment/export routes exist.
- Missing models for parity: LoanCollateral, LoanNote.
- Missing routes for parity: loan charges/docs/notes/collateral and high-risk servicing actions.

## Start Conditions for Implementation
- Keep existing financial invariants unchanged.
- Add authorization checks to each new route.
- Add idempotency keys for new financial mutation endpoints.
- Append audit and outbox events for all critical state changes.
