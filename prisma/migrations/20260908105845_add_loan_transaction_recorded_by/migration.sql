-- AlterTable
ALTER TABLE "public"."LoanTransaction" ADD COLUMN     "recordedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "LoanTransaction_recordedByUserId_idx" ON "public"."LoanTransaction"("recordedByUserId");

-- AddForeignKey
ALTER TABLE "public"."LoanTransaction" ADD CONSTRAINT "LoanTransaction_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
