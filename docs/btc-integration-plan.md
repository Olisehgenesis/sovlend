# BTC Integration Plan (Beta)

Status: **Design / discussion draft** — beta branch only. Nothing in this document is implemented yet. No real BTC custody, signing, or money movement exists in the codebase today. This doc exists so the team can agree on the model before any code is written.

## 0. What SovLend is, and why that matters here

SovLend is a loaning and savings SACCO platform. Its core is fully auditable, double-entry accounting: every posted journal balances debits and credits, journals and audit events are immutable once posted, and every state-changing action goes through one transaction pattern — permission check, office scope check, idempotency check, then in a single database transaction: update the aggregate, write balanced journal lines, store a price snapshot when relevant, append an audit event, append outbox events for downstream consumers.

This matters for BTC because **BTC is not going to be a separate, bolted-on system**. A BTC disbursement or repayment is still a loan transaction. It still goes through the same maker-checker approval, the same permission and office-scope checks, the same idempotency keys, the same immutable audit trail, and the same double-entry ledger — it simply also carries a price snapshot (BTC↔local-currency rate at that moment) and, once live custody exists, an external multisig signature step instead of (or alongside) an internal cash movement. Auditors reconstructing a loan's history should see BTC transactions in exactly the same audit trail, ledger, and export they already use for cash and mobile-money transactions — not a separate BTC ledger to reconcile by hand.

**Payout rail decision: Blink API.** For the actual movement of sats out to a borrower's or saver's own wallet, SovLend will use [Blink](https://www.blink.sv)'s API rather than running its own Lightning node or on-chain wallet infrastructure. Blink is a Bitcoin/Lightning wallet and payments platform (API docs: `dev.blink.sv`) that handles channel management, liquidity, and routing on our behalf — a payout becomes a single authenticated API call once SovLend's own maker-checker/multisig approval has already happened, not a piece of infrastructure SovLend has to operate and keep online itself.

## 1. Current limitation: single point of failure

Today, all platform funds sit behind one key / one wallet. Anyone who compromises that key — or any bug that misuses it — can drain or freeze the whole system. There is no maker-checker at the custody layer, only at the application/database layer (permission groups, approval limits). This is the specific limitation BTC integration must remove before it can move real money: **cryptographic** maker-checker, not just application-level maker-checker.

The architecture already anticipates this: private keys and seed phrases are explicitly kept outside SovLend's own systems — SovLend stores only public addresses, unsigned transaction data, transaction hashes, and external signer references. Production signing already belongs in independently controlled hardware wallets, HSMs, or a custody service. The multisig design below is the concrete plan for that signing layer.

## 2. How BTC transactions will work: signing as an extension of approval, not a new system

Today, a loan disbursement requires an approval step (maker-checker) enforced by permissions and the application. With BTC live, that same approval step **also becomes a signature requirement** — approving a BTC-funded disbursement is, mechanically, signing it. Nothing new for the human user to learn: the same roles that approve today are the same roles that sign tomorrow.

### Proposed architecture: 3-of-5 multisig treasury

BTC treasury funds move into a wallet requiring **3 of 5** signatures to move any funds. No single role, including SovLend's own systems, can unilaterally move money — this is what closes the single-point-of-failure gap in §1.

| # | Keyholder | Role in signing |
|---|---|---|
| 1 | System key (app-held, e.g. HSM/enclave) | Initiates — encodes that business rules (approval, limits, schedule) were satisfied before a human ever sees the request |
| 2 | Treasurer / Cashier | Signs — confirms the payout matches the disbursement/repayment record |
| 3 | Branch Manager | Signs — final human sign-off tied to their existing approval-limit authority |
| 4 | Compliance / Risk officer | Not used in the normal 3-signature flow; available for disputes, overrides, or when a normal signer is unavailable |
| 5 | Offline/cold backup (held by leadership, air-gapped) | Never used day-to-day; disaster-recovery only |

**Disbursement signing flow:**
1. Loan officer initiates the disbursement in the app as today (existing maker step). The system key co-signs automatically once existing business-rule checks pass (approval complete, limits respected, idempotency key present).
2. Treasurer or cashier reviews and signs (2nd signature) — the same human maker-checker split already used for cash disbursements.
3. Branch manager signs (3rd signature) — the same role that already approves loans/limits in the permission system, now extended to cryptographic sign-off.
4. Once 3 of 5 signatures are collected, the multisig releases the sats to SovLend's Blink account, and the app calls the Blink API to pay out to the borrower's own Lightning address/invoice (§6A). The multisig is what authorizes moving money out of SovLend's treasury; Blink is the payout rail that gets it the rest of the way to the recipient over Lightning.

### Addresses and security

- SovLend's own database never stores a private key or seed phrase — only public addresses, unsigned transaction payloads, broadcast transaction hashes, and a reference to which external signer/device produced each signature. This is unchanged from the existing architecture principle, just applied to BTC.
- Each loan/savings account that touches BTC gets its own receiving address (not a shared pool address), so on-chain activity is traceable per account without extra bookkeeping.
- Signing infrastructure runs in an isolated network/security domain from the web/worker app — a compromised web process cannot reach a signing device or HSM directly, it can only submit an unsigned transaction proposal into the queue that human signers see.
- The cold/offline 5th key is drilled periodically (frequency TBD in §7) so disaster recovery is proven, not theoretical.
- Blink's `Write`-scope API key (the one that can actually send payments) is a second, distinct secret from the multisig keys above — it lives only in server-side environment config, is never exposed to the browser, and is scoped so a compromised web process still cannot originate a payout on its own: the app only ever calls Blink's send-payment endpoint *after* the 3-of-5 approval in step 4 has already completed, so the API key by itself is not sufficient to move funds without also forging that approval trail first.

## 3. BTC price snapshot on every transaction

Every BTC-related loan or savings transaction — disbursement **and** repayment — records the BTC price at the exact moment of the transaction, using the same "price snapshot" concept the ledger already uses for FX:

- `btcPriceLocal` / `btcPriceUsd` — spot price at transaction time
- `priceSource` — which feed/oracle it came from
- `priceCapturedAt` — timestamp of the quote (may differ slightly from transaction time; both are stored)

This is required for: converting BTC amounts into local-currency ledger entries, reconstructing "what was this loan worth in UGX/USD at disbursement vs. today" for reporting, and driving the liquidity alert in §4.

Sketch: a `BtcPriceSnapshot` record linked 1:1 to the `LoanTransaction`/`SavingsTransaction` it accompanies, rather than adding BTC-specific columns to the existing transaction tables — keeps BTC-specific data additive and easy to roll back if the design changes.

## 4. BTC liquidity alerts

At the time of a repayment (and/or on a scheduled valuation job), compare the current BTC price against the outstanding loan amount it is meant to cover. If the BTC value has fallen to **less than or equal to** the outstanding loan amount, fire a liquidity alert — a margin-call trigger telling staff the BTC backing this loan may no longer cover it.

Needs: a recurring price-feed job independent of transaction events (so alerts fire between repayments too), a comparison pass against all open BTC-backed loans, and delivery through the existing notification/outbox pipeline (no new channel needed).

## 5. Charges and fees

BTC disbursement/withdrawal fees depend entirely on which rail is used (§6) — there is no flat platform-wide BTC fee. The Blink rail's own published fee structure (as of this writing, see `dev.blink.sv`) is:

| Rail | Fee | Who typically bears it |
|---|---|---|
| Blink Lightning payout (borrower/saver has a Blink wallet) | **Free** — intraledger transfers between Blink users have no fee | N/A |
| Blink Lightning payout (borrower/saver's wallet is elsewhere) | Routing fee only, typically **~0.02%** of the payment | Negligible; borrower/saver |
| Blink on-chain payout | Fixed sats fee: **5,000 sats** under 1M sats sent, **10,000 sats** at/above 1M sats, plus market-rate mining fees | Borrower/saver, or absorbed by SovLend (TBD) |
| Mobile Money off-ramp | **2–4%** conversion fee | TBD — borrower, platform, or split |
| P2P | Market-set (varies by counterparty) | Whoever agrees to the trade |
| Binance / exchange transfer | Exchange's own withdrawal fee | Borrower/saver, as with any exchange |

Multiple disbursement options exist side by side (Blink/Lightning, MoMo, P2P, Binance) rather than one fixed path, so the fee a given borrower pays depends on the option they choose — the Lightning rail is both the cheapest and the fastest, so it is presented first, with MoMo positioned as the convenient-but-costlier fallback.

## 6. Disbursement and savings options

### A. BTC wallet via Blink (primary, cheapest, instant)
Funds move directly to the borrower's or saver's own Lightning wallet via the **Blink API**: SovLend's server calls Blink's send-payment endpoint with the recipient's Lightning invoice/address once the multisig approval in §2 has released the funds. Settlement is final in seconds. If the recipient also uses Blink, the transfer is free (intraledger); otherwise it costs only the small routing fee (~0.02%, see §5). This is the preferred rail: fastest, cheapest, and keeps the funds in BTC for anyone who wants to hold or spend BTC directly. All users — not just borrowers — can hold savings in BTC directly in their SovLend wallet, and Blink is the same API used to source and confirm those balances.

Operationally, this means SovLend needs one Blink account (business account) holding a `Write`-scope API key server-side, plus each borrower/saver either has their own Blink wallet (free, instant transfers) or supplies any Lightning address/invoice from a wallet of their choice (still fast, small routing fee). No SovLend-run Lightning node or channel management is required — Blink operates that infrastructure on our behalf.

### B. Mobile Money (last resort)
Off-ramp via a BTC/MoMo conversion partner, cash-out to MTN/Airtel MoMo. Fee: **2–4%** (see §5). Positioned as the fallback option for borrowers who need local currency immediately and don't want to hold BTC themselves — not the default path.

### C. P2P
Borrowers/savers can also settle peer-to-peer directly, outside SovLend's own conversion partner — useful where a trusted local counterparty offers a better rate than the MoMo off-ramp.

### D. Binance (or similar exchange)
Funds can be sent to a borrower's own Binance-style exchange account, letting them choose their own exit rail (hold, trade, or cash out) after receipt, at the exchange's own fee.

### Future: MiniPay integration
MiniPay (or similar) already runs low-fee BTC/stablecoin-to-mobile-money rails in our target markets. Integrating removes the need for SovLend to build/maintain its own off-ramp liquidity and should bring the MoMo fee down over time.

### Future: card spend
Issue a card (virtual, later physical) linked to a BTC-denominated account so a borrower or saver can spend BTC directly at POS/online, with conversion happening behind the scenes at time of spend. Requires a card-issuing partner that settles in BTC or has a BTC on/off-ramp built in.

## 7. Phase 1 (this beta): read-only custody

Before any of the multisig/live-money-movement design above ships, beta introduces BTC accounts in **read-only** mode:

- BTC loan/savings accounts exist as data records — balance, address, linked client — and display balances plus their local-currency equivalent using the price snapshot mechanism from §3.
- SovLend holds and moves **no real BTC** in this phase. Balances/transactions shown are sourced read-only (e.g. from a custody provider's read API, or a public on-chain address balance) so staff and investors can see and get comfortable with BTC-denominated reporting before the platform takes on custody risk.
- Investor role gets a new read-only dashboard view: aggregate BTC + fiat position, funds under management, BTC exposure — no ability to move money or approve transactions.
- Phase 2 (post-beta, pending security/compliance review) introduces the 3-of-5 multisig for actual disbursement/repayment money movement, and the disbursement/savings rails in §6 go live.

## 8. Open questions (must be answered before Phase 2 build starts)

- Who holds the 5 keys, by name/role, and where are they custodied (HSM, hardware wallets, a multisig coordinator like a hosted service)?
- Which multisig implementation — native Bitcoin script multisig we run ourselves, or an API-based custody provider with multisig/policy support?
- Does the SovLend treasury multisig fund a Blink account directly, or does Blink sit further downstream (e.g. multisig releases to an intermediate wallet that then funds Blink)? This determines exactly where the multisig's authority ends and Blink's payout responsibility begins.
- Who holds and rotates the Blink `Write`-scope API key, and what is the incident-response plan if it leaks (Blink lets you revoke/rotate keys from the dashboard — how quickly can SovLend act)?
- Do we use Blink's hosted service, or self-host Blink's open-source stack (`Build with Blink`) for more control over custody — and does that decision change based on regulatory requirements in Uganda?
- Which BTC price oracle/source feeds the snapshot in §3, and how do we handle a stale or unavailable feed? (Is Blink's own rate, used internally for its USD/Stablesats feature, a candidate source, or do we need an independent oracle for audit purposes?)
- What licensing/compliance is required to custody BTC for customers in Uganda, and does Phase 2 need a separate regulated entity?
- Who absorbs the MoMo off-ramp's 2–4% fee — borrower, platform, or split — and does that differ for P2P/Binance rails?
- How often is the 5th (cold/offline) key drilled in a live disaster-recovery test?
