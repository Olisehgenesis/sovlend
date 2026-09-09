-- AlterTable
ALTER TABLE "public"."Loan" ADD COLUMN     "topUpOfLoanId" UUID;

-- CreateIndex
CREATE INDEX "Loan_topUpOfLoanId_idx" ON "public"."Loan"("topUpOfLoanId");

-- AddForeignKey
ALTER TABLE "public"."Loan" ADD CONSTRAINT "Loan_topUpOfLoanId_fkey" FOREIGN KEY ("topUpOfLoanId") REFERENCES "public"."Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
