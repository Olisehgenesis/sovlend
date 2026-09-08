/*
  Warnings:

  - You are about to drop the column `fund` on the `LoanApplication` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Loan" ADD COLUMN     "fundId" UUID;

-- AlterTable
ALTER TABLE "public"."LoanApplication" DROP COLUMN "fund",
ADD COLUMN     "fundId" UUID;

-- CreateTable
CREATE TABLE "public"."Fund" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "ledgerAccountId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Fund_organizationId_isActive_idx" ON "public"."Fund"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "Fund_ledgerAccountId_idx" ON "public"."Fund"("ledgerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Fund_organizationId_name_key" ON "public"."Fund"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Fund_organizationId_code_key" ON "public"."Fund"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Loan_fundId_status_idx" ON "public"."Loan"("fundId", "status");

-- CreateIndex
CREATE INDEX "LoanApplication_fundId_status_idx" ON "public"."LoanApplication"("fundId", "status");

-- AddForeignKey
ALTER TABLE "public"."Fund" ADD CONSTRAINT "Fund_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Fund" ADD CONSTRAINT "Fund_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanApplication" ADD CONSTRAINT "LoanApplication_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "public"."Fund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Loan" ADD CONSTRAINT "Loan_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "public"."Fund"("id") ON DELETE SET NULL ON UPDATE CASCADE;
