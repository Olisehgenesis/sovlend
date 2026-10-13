-- Align statutory loan product rates with written policy.
-- Business loan (weekly & monthly): interest 2.8%, monitoring 2.2% per month, processing 5%.
-- Group loan: interest 2%, monitoring 1% per month, processing 2% (unchanged), LIF 15% (unchanged).
-- Update only where the target field is still at its default to avoid clobbering manual edits.

UPDATE "LoanProduct"
SET "annualRateBps" = 3360,
    "monitoringFeeAnnualRateBps" = 2640,
    "processingFeeBps" = 500
WHERE name IN ('BUSINESS WEEKLY LOAN', 'BUSINESS LOAN MONTHLY')
  AND "annualRateBps" = 6000
  AND "monitoringFeeAnnualRateBps" = 0
  AND "processingFeeBps" = 200;

UPDATE "LoanProduct"
SET "annualRateBps" = 2400,
    "monitoringFeeAnnualRateBps" = 1200
WHERE name = 'GROUP LOAN PRODUCT'
  AND "annualRateBps" = 3600
  AND "monitoringFeeAnnualRateBps" = 0
  AND "processingFeeBps" = 200;
