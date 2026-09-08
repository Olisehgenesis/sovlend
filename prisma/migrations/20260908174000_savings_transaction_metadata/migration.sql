-- AlterTable
ALTER TABLE "public"."SavingsTransaction" ADD COLUMN     "reason" TEXT,
ADD COLUMN     "recordedByUserId" TEXT,
ADD COLUMN     "settlementAccountId" UUID;

-- CreateIndex
CREATE INDEX "SavingsTransaction_settlementAccountId_idx" ON "public"."SavingsTransaction"("settlementAccountId");

-- CreateIndex
CREATE INDEX "SavingsTransaction_recordedByUserId_idx" ON "public"."SavingsTransaction"("recordedByUserId");

-- AddForeignKey
ALTER TABLE "public"."SavingsTransaction" ADD CONSTRAINT "SavingsTransaction_settlementAccountId_fkey" FOREIGN KEY ("settlementAccountId") REFERENCES "public"."SettlementAccountMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SavingsTransaction" ADD CONSTRAINT "SavingsTransaction_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
