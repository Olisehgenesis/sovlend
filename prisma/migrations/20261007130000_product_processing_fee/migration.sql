ALTER TABLE "LoanProduct" ADD COLUMN "processingFeeBps" INTEGER NOT NULL DEFAULT 200;
ALTER TABLE "LoanProduct" ADD CONSTRAINT "LoanProduct_processingFeeBps_check" CHECK ("processingFeeBps" BETWEEN 0 AND 10000);
