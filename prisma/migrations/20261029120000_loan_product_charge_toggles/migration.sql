ALTER TABLE "public"."LoanProduct" ADD COLUMN "collectProcessingFee" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "public"."LoanProduct" ADD COLUMN "collectLif" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "public"."LoanProduct" ADD COLUMN "collectExtraCharges" BOOLEAN NOT NULL DEFAULT true;
