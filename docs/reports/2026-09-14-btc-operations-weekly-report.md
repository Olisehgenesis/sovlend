# SovLend / Jump Start Africa — BTC Operations Weekly Report

**Date:** 14 September 2026
**Prepared for:** Jump Start Africa leadership, Fred Mawanda, and partner stakeholders
**Prepared by:** Oliseh Mwijusya (Genesis)
**Status:** Working phase — live and operating, not yet the full target design

---

## 1. In one paragraph

SovLend now runs a working Bitcoin top-up channel alongside its existing loan and savings system. Investors send BTC over Lightning to fund the institution; loans can be disbursed to clients in cash, mobile money, bank transfer, or BTC, chosen by the cashier at the point of disbursement. The system is not the full end-state design yet — it is the first working phase, built to be safe, get real use, and be extended as we go. Nothing here changes the loan accounting SovLend already runs on: every BTC movement still goes through the same permission checks, approvals, and immutable ledger as every other transaction.

## 2. How BTC comes into the system today

1. An investor (or Fred, acting as manager) opens their portal and requests a Lightning invoice for a chosen amount.
2. SovLend calls the Blink Lightning API and generates a real invoice (a `lnbc...` string plus a QR code).
3. The investor pays the invoice from any Lightning wallet.
4. SovLend confirms the payment two ways — a webhook from Blink, and a background check that keeps polling in case the webhook is missed — and credits the investor's contribution once payment is confirmed on-chain of the Lightning network.
5. The amount is priced at BTC/USD and USD/UGX rates captured at the moment of the invoice, so every contribution has a permanent, reproducible record of what it was worth when it was made.

This is live in production today. It is the on-ramp: BTC in, from an investor, into SovLend's operational balance.

## 3. Where the BTC goes: Fred's role as treasury manager

BTC received from investors flows into SovLend's own treasury account, which **Fred manages** as the institution's designated treasury manager. This is the current, hands-on version of what will later be an automated treasury process (see §7). Today it depends on Fred:

- receiving the BTC,
- converting or holding it as directed,
- and topping up SovLend's operating balance so loan disbursements in BTC can be paid out.

This is a manual step by design at this phase — it lets us run real transactions safely, with a known person accountable for every movement, before we automate the treasury layer.

## 4. How loans go out: four disbursement channels

When a cashier disburses an approved loan, they choose the channel:

- **Cash**
- **Mobile money**
- **Bank transfer**
- **BTC (Lightning)**

The loan is still recorded, scheduled, and accounted for exactly the same way regardless of channel — the channel is how the client actually receives the money, not a different loan product. Interest, fees, and the repayment schedule don't change based on which rail was used to pay out.

## 5. Keeping BTC disbursements safe: the current control

Because BTC is new and moves faster and more irreversibly than mobile money, we are running it under a tighter interim policy than other channels:

- **Cashier-level BTC transfers are capped at $500/day.**
- **Anything above that requires the branch manager's approval before it goes out.**

**Important — this is currently a manual/policy control, not yet a hard system limit.** The system does not yet block a cashier from exceeding $500 in BTC in a day on its own; the cap is enforced through training and manager sign-off today. Making this a system-enforced limit (so the software refuses the transaction rather than relying on the cashier following policy) is one of the concrete next steps in §8 and is tracked as a real gap in the companion feature-gap report.

## 6. Accounting: BTC is treated as a first-class channel, not an afterthought

BTC is not bolted on. Every BTC-priced transaction — an investor contribution, a BTC disbursement — is:

- priced against a stored BTC/USD (and local-currency) rate snapshot taken at that moment,
- posted through the same double-entry ledger as every cash or mobile-money transaction,
- subject to the same maker-checker approval rules already used for other disbursements,
- permanently recorded — nothing is edited after the fact; corrections happen through a new offsetting entry, never by changing history.

This means an auditor looking at a loan's history sees BTC transactions in the same trail as everything else, not a separate BTC ledger to reconcile by hand.

## 7. What's next

1. **Roll out to staff.** Fred and the cashier team need hands-on training: how an investor invoice is created, how a BTC disbursement is recorded, what the $500/day policy means in practice, and how to escalate to a manager. This is happening as we go — train, watch, correct, repeat — rather than a single big-bang launch.
2. **Make the $500/day cap a system rule**, not just a policy cashiers are trained to follow (see §5 and the gap report).
3. **Automate the treasury top-up step** currently done by hand through Fred, moving toward the multisig-controlled treasury described in the original technical proposal, once volume and risk justify the extra operational weight.
4. **Close the feature gaps** between what was proposed at the start of this project and what is live today — see the companion report, `docs/reports/2026-09-14-btc-feature-gap-analysis.md`, for the itemized list and the task backlog built from it.

## 8. Technical, security, and core summary

- **Payment rail:** Blink Lightning API — SovLend does not run its own Lightning node; Blink handles routing, liquidity, and channel management.
- **Pricing:** every BTC-denominated event stores its own price snapshot at the time it happened; nothing is priced retroactively.
- **Ledger:** double-entry, append-only, and balance-checked per currency on every post. BTC transactions use the same ledger as cash/mobile-money/bank transactions — there is one ledger, not a BTC-only side ledger.
- **Approvals:** existing maker-checker and office/permission scoping applies to BTC transactions exactly as it does to any other loan or disbursement action.
- **Custody today:** BTC funds are held in SovLend's own treasury account, administered by Fred day to day. There is **no live multisig or cold-storage vault yet** — that is a planned phase, not a current control (see the gap report, item on treasury custody).
- **Known limitation:** the $500/day BTC cashier cap is policy-enforced (training + manager approval), not yet code-enforced. This is the single most important near-term hardening item.

---

*This report describes the system as it operates today. It intentionally does not claim capabilities that are not yet live — see the companion gap-analysis report for a full comparison against the original project proposal.*
