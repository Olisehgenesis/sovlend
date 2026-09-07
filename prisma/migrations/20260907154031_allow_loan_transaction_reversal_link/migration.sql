-- The append-only trigger installed in 20260901190000_immutable_financial_records blocked
-- every UPDATE on "LoanTransaction" unconditionally, including the one and only mutation the
-- reversal/prepay/foreclosure workflow performs: linking an original transaction to its
-- reversal via reversedById (see executeTransactionReversal in
-- src/modules/lending/application/loan-service-actions.ts). That workflow would fail in
-- production with "LoanTransaction records are append-only" today.
--
-- This replaces the LoanTransaction trigger with a guarded version that permits exactly one
-- linkage update per row (reversedById going from NULL to a value, with every other column
-- unchanged) while still fully blocking deletes and any other mutation, including changing an
-- already-set reversedById. AuditEvent/PriceSnapshot/SavingsTransaction remain fully
-- append-only via the untouched prevent_row_mutation() trigger function.

CREATE OR REPLACE FUNCTION prevent_loan_transaction_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LoanTransaction records are append-only';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD."reversedById" IS NULL
     AND NEW."reversedById" IS NOT NULL
     AND OLD.id = NEW.id
     AND OLD."loanId" = NEW."loanId"
     AND OLD."transactionType" = NEW."transactionType"
     AND OLD."businessDate" = NEW."businessDate"
     AND OLD."settlementCurrency" = NEW."settlementCurrency"
     AND OLD."settlementChannel" = NEW."settlementChannel"
     AND OLD."settlementAmountMinor" = NEW."settlementAmountMinor"
     AND OLD."denominationAmountMinor" = NEW."denominationAmountMinor"
     AND OLD."idempotencyKey" = NEW."idempotencyKey"
     AND OLD."createdAt" = NEW."createdAt"
     AND OLD."settlementAccountId" IS NOT DISTINCT FROM NEW."settlementAccountId"
     AND OLD."priceSnapshotId" IS NOT DISTINCT FROM NEW."priceSnapshotId"
     AND OLD."externalReference" IS NOT DISTINCT FROM NEW."externalReference"
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'LoanTransaction records are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS loan_transaction_append_only ON "LoanTransaction";
CREATE TRIGGER loan_transaction_append_only
BEFORE UPDATE OR DELETE ON "LoanTransaction"
FOR EACH ROW EXECUTE FUNCTION prevent_loan_transaction_mutation();