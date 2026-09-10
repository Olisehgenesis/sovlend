# BTC Integration Plan (Beta)

Status: **Design / discussion draft** — beta branch only. Nothing in this document is implemented yet. No real BTC custody, signing, or money movement exists in the codebase today. This doc exists so the team can agree on the model before any code is written.

## 0. Why now

Investors and branch management need visibility into BTC-denominated funds, and we want to start offering BTC-backed loan/savings accounts. Before we touch real custody, we introduce BTC accounts in **read-only** mode so staff and investors can see balances, prices, and transaction history without SovLend holding or moving a single satoshi. Live custody is a separate, later phase gated on security/compliance review.

## 1. Problem: today's single point of failure

All platform funds currently sit behind one key/one wallet. Anyone who compromises that key — or any bug that misuses it — can drain or freeze the whole system. There is no maker-checker at the custody layer, only at the application/database layer (permission groups, approval limits). BTC custody needs the same maker-checker discipline enforced cryptographically, not just in application code.

## 2. Proposed architecture: 3-of-5 multisig treasury

Move BTC treasury funds into a wallet requiring **3 of 5** signatures to move any funds. No single role, including SovLend's own systems, can unilaterally move money.

### Suggested keyholders (5 keys)

| # | Keyholder | Normal role in signing |
|---|---|---|
| 1 | System key (app-held, e.g. HSM/enclave) | Initiates — encodes that business rules (approval, limits, schedule) were satisfied before a human ever sees the request |
| 2 | Treasurer / Cashier | Signs — confirms the payout matches the disbursement/repayment record |
| 3 | Branch Manager | Signs — final human sign-off tied to their existing approval-limit authority |
| 4 | Compliance / Risk officer | Not used in the normal 3-signature flow; available for disputes, overrides, or when a normal signer is unavailable |
| 5 | Offline/cold backup (held by leadership, air-gapped) | Never used in day-to-day flow — disaster-recovery only |

### Disbursement signing flow

1. **Loan officer** initiates the disbursement in the app as today (existing maker step). The app's **system key** co-signs automatically once all existing business-rule checks pass (approval complete, limits respected, idempotency key present).
2. **Treasurer or cashier** reviews and signs (2nd signature) — this is a human maker-checker step distinct from the loan officer, matching how cash disbursements are already separated from loan origination.
3. **Branch manager** signs for the loan (3rd signature) — same role that already approves loans/limits in the permission system, now extended to cryptographic sign-off.
4. Once 3 of 5 signatures are collected, the transaction broadcasts and funds leave the multisig to the destination rail (see §5).

This mirrors the maker-checker/approval-limit pattern already built for loan approval and permission groups — we are extending an existing pattern into the custody layer, not inventing a new one.

## 3. BTC price snapshot on every transaction

Every loan-related BTC movement — disbursement **and** repayment — records the BTC price at the exact moment of the transaction:

- `btcPriceLocal` / `btcPriceUsd` — spot price at transaction time
- `priceSource` — which feed/oracle it came from
- `priceCapturedAt` — timestamp of the quote (may differ slightly from transaction time; both are stored)

This gives an immutable, auditable price history per transaction, which is required for:

- Converting BTC amounts to local-currency ledger entries for accounting.
- Reconstructing "what was this loan worth in UGX/USD at disbursement vs. today" for reporting.
- Driving the liquidity alert in §4.

Sketch: a `BtcPriceSnapshot` record linked 1:1 to the `LoanTransaction`/`SavingsTransaction` it accompanies, rather than adding BTC-specific columns to the existing transaction tables — keeps BTC-specific data additive and easy to roll back if the design changes.

## 4. BTC liquidity alerts

At the time of a repayment (and/or on a scheduled valuation job), compare the current BTC price against the outstanding loan amount it is meant to cover. If the BTC value has fallen to **less than or equal to** the outstanding loan amount, fire a liquidity alert — this is effectively a margin-call trigger telling staff the BTC backing this loan may no longer cover it.

Needs:
- A recurring price-feed job (e.g. every N minutes) independent of transaction events, so alerts also fire between repayments, not only at repayment time.
- A comparison pass against all open BTC-backed loans.
- Delivery through the existing notification/outbox pipeline (no new channel needed).

## 5. Disbursement rails — two options

### A. BTC → Mobile Money (fast)
- Off-ramp via a BTC/MoMo conversion partner.
- Fee: **2–4%**, borne by whoever we decide (borrower, platform, or split — TBD).
- Instant cash-out to MTN/Airtel MoMo — best for borrowers who need local currency immediately.

### B. BTC-native transfer (free, instant)
- Straight to the borrower's own BTC wallet, or a Binance-style account they control.
- No conversion fee; settlement is on-chain/Lightning depending on rail chosen.
- Best for borrowers who want to hold BTC or already transact in BTC.

### C. Future: MiniPay integration
MiniPay (or similar) already runs low-fee BTC/stablecoin-to-mobile-money rails in our target markets. Integrating removes the need for SovLend to build/maintain its own off-ramp liquidity and should bring the 2–4% fee down over time.

### D. Future: card spend
Issue a card (virtual, later physical) linked to a BTC-denominated account so a borrower or saver can spend BTC directly at POS/online, with conversion happening behind the scenes at time of spend. Requires a card-issuing partner that settles in BTC or has a BTC on/off-ramp built in.

## 6. Phase 1 (this beta): read-only custody

Before any of the multisig/live-money-movement design above ships, beta introduces BTC accounts in **read-only** mode:

- BTC loan/savings accounts exist as data records — balance, address, linked client — and display balances plus their local-currency equivalent using the price snapshot mechanism from §3.
- SovLend holds and moves **no real BTC** in this phase. Balances/transactions shown are sourced read-only (e.g. from a custody provider's read API, or a public on-chain address balance) so staff and investors can see and get comfortable with BTC-denominated reporting before the platform takes on custody risk.
- Investor role gets a new read-only dashboard view: aggregate BTC + fiat position, funds under management, BTC exposure — no ability to move money or approve transactions, matching the investor-visibility request that prompted this doc.
- Phase 2 (post-beta, pending security/compliance review) introduces the 3-of-5 multisig for actual disbursement/repayment money movement.

## 7. Open questions (must be answered before Phase 2 build starts)

- Who holds the 5 keys, by name/role, and where are they custodied (HSM, hardware wallets, a multisig coordinator like a hosted service)?
- Which multisig implementation — native Bitcoin script multisig we run ourselves, or an API-based custody provider with multisig/policy support?
- Which BTC price oracle/source feeds the snapshot in §3, and how do we handle a stale or unavailable feed?
- What licensing/compliance is required to custody BTC for customers in Uganda, and does Phase 2 need a separate regulated entity?
- Which partner handles the BTC→MoMo 2–4% off-ramp, and who absorbs that fee?
- Does the 5th (cold/offline) key ever need to be used in a live drill, and how often is that tested?
