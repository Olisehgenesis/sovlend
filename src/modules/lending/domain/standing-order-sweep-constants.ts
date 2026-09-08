// Shared identifiers for the standing-order sweep feature. Kept in one place so the
// provisioning script, the scanner, and the worker all agree on how to find the system actor
// and the settlement account it posts sweep repayments through.
export const STANDING_ORDER_SYSTEM_EMAIL = "standing-order-automation@sovlend.internal";
export const STANDING_ORDER_PERMISSION_GROUP_NAME = "Standing Order Automation";
export const STANDING_ORDER_SETTLEMENT_ACCOUNT_NAME = "Client Savings Sweep";
export const STANDING_ORDER_SETTLEMENT_ACCOUNT_TYPE = "SAVINGS_SWEEP";
// "OTHER LIABILITIES - Savings Balances" -- the same fallback GL code the historical savings
// ledger backfill (backfill-ledger-savings.ts) posts to when a savings product has no
// dedicated liability account. Reusing it keeps the sweep consistent with that convention:
// DEBIT this liability account (a client's savings balance going down), CREDIT the loan's
// principal/interest/fee/penalty income accounts (the normal repayment allocation).
export const STANDING_ORDER_LIABILITY_ACCOUNT_CODE = "20004";
