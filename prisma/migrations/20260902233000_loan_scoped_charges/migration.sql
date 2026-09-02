-- AlterTable
ALTER TABLE "public"."Charge" ADD COLUMN "loanId" UUID;

-- CreateIndex
CREATE INDEX "Charge_loanId_status_idx" ON "public"."Charge"("loanId", "status");

-- CreateIndex
CREATE INDEX "Charge_loanId_dueOn_idx" ON "public"."Charge"("loanId", "dueOn");

-- AddForeignKey
ALTER TABLE "public"."Charge" ADD CONSTRAINT "Charge_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "public"."Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
