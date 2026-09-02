-- AlterTable
ALTER TABLE "public"."SavingsAccount" ADD COLUMN     "fieldOfficerId" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "submittedOn" DATE;

-- AlterTable
ALTER TABLE "public"."Charge" ADD COLUMN     "savingsAccountId" UUID;

-- CreateIndex
CREATE INDEX "Charge_savingsAccountId_idx" ON "public"."Charge"("savingsAccountId");

-- AddForeignKey
ALTER TABLE "public"."SavingsAccount" ADD CONSTRAINT "SavingsAccount_fieldOfficerId_fkey" FOREIGN KEY ("fieldOfficerId") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Charge" ADD CONSTRAINT "Charge_savingsAccountId_fkey" FOREIGN KEY ("savingsAccountId") REFERENCES "public"."SavingsAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
