# BTC Feature Gap Analysis — Proposal vs. Delivered

**Date:** 14 September 2026
**Compares:** the original *BTC-Enabled Microfinance System* proposal (July 2026) against what is actually implemented in SovLend today.
**Method:** every row below was verified directly against the codebase (file paths given), not against intent or documentation claims. "Partial" means the underlying data model or a piece of the flow exists, but the feature as described in the proposal does not work end-to-end yet.

This report exists because features have been described in conversation, proposals, and status updates as "done" or "available" at different points, and some of those descriptions ran ahead of what the code actually does. This is the honest reconciliation.

---

## 1. Summary table

| # | Proposed feature | Status | Evidence | What actually exists today |
|---|---|---|---|---|
| 1 | Investor Lightning/BTC deposit via Blink | ✅ **EXISTS** | `src/modules/investments/application/create-investment.ts`, `src/modules/investments/infrastructure/blink-gateway.ts`, `src/modules/investments/application/settle-lightning-invoice.ts`, `src/modules/investments/application/scan-pending-investment-settlements.ts` | Investor requests a Blink invoice, pays it, settlement confirmed via webhook + polling fallback, priced with a stored rate snapshot. **Live.** |
| 2 | Investor withdrawal request → admin review → multisig approval → payout | 🚫 **Not offered by design** | No route/module found under `src/app/api/investor/*` or `src/modules/investments/` handling withdrawals | Investor contributions are treated as capital committed to the institution, not a redeemable deposit — SovLend does not offer a self-service withdrawal path, and none is planned. |
| 3 | 3-of-5 multisig treasury / cold storage vault | ⚠️ **PARTIAL** | `prisma/schema.prisma` — `SystemWallet` (`kind: COLD_MULTISIG`), `TransferProposal` | The data model anticipates a multisig wallet and a transfer-proposal/approval record, but there is no signing integration, no HSM/hardware-wallet connection, and no live multisig wallet. Today, BTC treasury movement is a manual step through Fred (see operations report §3). |
| 4 | Allocation engine (admin earmarks pooled capital for a loan without moving wallet balances) | ❌ **MISSING** | No allocation-engine module found | Loans are funded through the existing ledger/journal flow directly; there is no separate reservation layer between investor pool capital and a specific loan. |
| 5 | Hot wallet vs. cold vault separation with treasury supply reporting | ⚠️ **PARTIAL** | `prisma/schema.prisma` — `SystemWallet`; `src/modules/reporting/application/dashboard.ts` | A system-wallet model and a capital-position dashboard section exist, but there is no hot/cold split enforced operationally and no dedicated "company BTC treasury supply" report for admins. |
| 6 | Client BTC savings accounts (voluntary BTC savings, separate from loan balance) | ⚠️ **PARTIAL** | `prisma/schema.prisma` — `ClientBtcAccount`; `src/modules/btc/application/load-client-btc-accounts.ts`, `load-investor-btc-exposure.ts` | Client BTC accounts exist as **read-only/manually recorded balances** for reporting and exposure calculation. There is no client-facing deposit/withdrawal flow into a BTC savings product. |
| 7 | Client repays an active loan directly in BTC | ❌ **MISSING** | `src/modules/lending/application/post-repayment.ts` handles fiat/loan-ledger repayment only | Repayments are recorded in local currency through the standard repayment flow. No BTC repayment path exists. |
| 8 | Cashier/teller chooses disbursement channel: cash, mobile money, bank, BTC | ⚠️ **PARTIAL** | `src/modules/lending/application/disburse-loan.ts`, `src/components/disburse-loan-form.tsx` | The cashier can record which settlement account/payment method the payout used (including a BTC-labelled channel), but disbursement always credits the client's savings account net of fees first — BTC is not yet a distinct payout rail that pushes sats to a client's own wallet. |
| 9 | $500/day BTC cashier cap requiring manager approval above that | ✅ **EXISTS** | `src/modules/lending/application/disburse-loan.ts` (BTC-cap enforcement, per-actor/per-business-day accumulation, `BtcDisbursementApprovalRequiredError`), `permissions.loanDisburseBtcOverCap` (`LOAN_DISBURSE_BTC_OVER_CAP`) | A cashier's cumulative same-day BTC disbursements (USD-equivalent, priced off a fresh BTC/USD + USD/UGX snapshot) are capped at $500; exceeding it without the manager-only override permission throws and is audit-logged. Now system-enforced, not policy-only. |
| 10 | Append-only ledger with a BTC price snapshot on every deposit/allocation/disbursement/repayment/vault movement | ⚠️ **PARTIAL** | `prisma/schema.prisma` — `PriceSnapshot`, `InvestmentCommitment.priceSnapshotId`; ledger is append-only and balance-checked generally | Investor contributions are snapshotted. There is no unified BTC-specific ledger stream covering allocation/vault movements (because those flows don't exist yet — see #3, #4). |
| 11 | Admin dashboard: investor pool balance, company BTC treasury supply | ⚠️ **PARTIAL** | `src/app/(app)/page.tsx`, `src/modules/reporting/application/dashboard.ts` | Investor capital and client-savings liability are visible on the main ops dashboard. A dedicated BTC treasury-supply view (company's own accumulated BTC, separate from investor capital) does not exist yet. |
| 12 | Role-based dashboards: Investor / Admin / Teller / Client | ⚠️ **PARTIAL** | Investor: `src/app/investor/page.tsx`; Admin/backoffice: `src/app/(app)/page.tsx`, `src/app/(app)/backoffice/*`; Client: `src/app/portal/page.tsx` | Investor, admin, and client portals exist and are live. **There is no dedicated teller dashboard** — cashiers currently work through the general staff app rather than a purpose-built teller view. |
| 13 | `btc_price_snapshots` historical rate table | ⚠️ **PARTIAL** | `prisma/schema.prisma` — `PriceSnapshot` | A generic multi-pair price-snapshot table exists (BTC/USD, USD/UGX, etc.) and is used for investor contributions. It is not a BTC-only table, but it serves the same purpose. |

## 2. What this means in plain terms

**Fully live and real:** investors can fund SovLend in BTC over Lightning today, and that money is priced, recorded, and swept to Fred for treasury handling. Loan disbursement channel choice (cash/mobile money/bank/BTC-label) exists for cashiers.

**Built on paper, not yet in code:** the multisig treasury, the allocation engine, and BTC loan repayment were all described in the original proposal and are part of the intended end-state, but none of them exist in the running system yet. Where they've been mentioned as available in status updates, that was ahead of the code — this report corrects that. (Investor withdrawals were also in the original proposal but are intentionally not being built — see row 2.)

**Policy standing in for a system control:** the $500/day BTC cap is real as a business rule Fred and the cashier team follow, but the software does not yet enforce it. This is flagged in the operations report as the top near-term hardening priority.

## 3. Task backlog (in priority order)

The following tracks the work needed to close the gaps above. Use this the same way `docs/loan-implementation-agents.md` tracks loan-parity work — pick a track, complete it, mark it done, move to the next.

| # | Track | Scope | Priority | Status |
|---|---|---|---|---|
| 1 | System-enforced BTC daily cap | Add a BTC-specific daily transfer limit per cashier/role, enforced at the disbursement API layer (reject over-cap without manager approval, not just train around it) | **High — closes the biggest live risk** | ✅ Done |
| 2 | Teller dashboard | Purpose-built cashier/teller view: today's disbursements, repayments to record, BTC vs. fiat channel picker, pending manager approvals | High | Not started |
| 3 | BTC treasury supply dashboard | Admin-facing view of company-owned BTC accumulated over time (separate from investor pool capital), sourced from `SystemWallet` | Medium | Not started |
| 4 | Allocation engine | Ledger-level reservation of pooled investor capital against a specific loan or batch, before any wallet balance actually moves | Medium | Not started |
| 5 | Multisig treasury integration | Wire up real signing (hardware wallet/HSM-backed) against the existing `SystemWallet`/`TransferProposal` schema; formalize the 3-of-5 signer flow described in `docs/btc-integration-plan.md` | Medium (deliberately after cap enforcement and volume justify the operational weight) | Design exists (`docs/btc-integration-plan.md`), no signing code yet |
| 6 | Client BTC savings product | Turn `ClientBtcAccount` from a read-only balance into a real deposit/withdrawal-capable savings product | Lower | Not started |
| 7 | BTC loan repayment | Allow a client to repay an active loan directly in BTC, settling into the operational hot wallet, with the same price-snapshot discipline as disbursement | Lower | Not started |

Investor withdrawals are intentionally excluded from this backlog — see §2, row 2.

## 4. Related documents

- `docs/reports/2026-09-14-btc-operations-weekly-report.md` — the plain-language operations status this gap analysis supports.
- `docs/btc-integration-plan.md` — the existing multisig/architecture design draft (item 6 above builds directly on this).
- `docs/STATUS.md` — the general (non-BTC) implementation status baseline.
