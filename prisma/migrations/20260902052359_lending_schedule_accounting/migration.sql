-- AlterTable
ALTER TABLE "public"."LedgerAccount" ADD COLUMN     "description" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "manualEntriesAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "usage" TEXT NOT NULL DEFAULT 'DETAIL';

-- AlterTable
ALTER TABLE "public"."Loan" ADD COLUMN     "scheduleVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "termsSnapshot" JSONB;

-- CreateTable
CREATE TABLE "public"."LoanProductAccountingMapping" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "principalReceivableAccountId" UUID NOT NULL,
    "interestReceivableAccountId" UUID,
    "interestIncomeAccountId" UUID NOT NULL,
    "feeIncomeAccountId" UUID,
    "penaltyIncomeAccountId" UUID,
    "writeOffExpenseAccountId" UUID,
    "overpaymentLiabilityAccountId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanProductAccountingMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SettlementAccountMapping" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "currencyCode" VARCHAR(10) NOT NULL,
    "ledgerAccountId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementAccountMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoanProductAccountingMapping_productId_key" ON "public"."LoanProductAccountingMapping"("productId");

-- CreateIndex
CREATE INDEX "SettlementAccountMapping_ledgerAccountId_idx" ON "public"."SettlementAccountMapping"("ledgerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementAccountMapping_organizationId_channel_currencyCod_key" ON "public"."SettlementAccountMapping"("organizationId", "channel", "currencyCode");

-- AddForeignKey
ALTER TABLE "public"."LoanProductAccountingMapping" ADD CONSTRAINT "LoanProductAccountingMapping_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."LoanProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanProductAccountingMapping" ADD CONSTRAINT "LoanProductAccountingMapping_principalReceivableAccountId_fkey" FOREIGN KEY ("principalReceivableAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanProductAccountingMapping" ADD CONSTRAINT "LoanProductAccountingMapping_interestReceivableAccountId_fkey" FOREIGN KEY ("interestReceivableAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanProductAccountingMapping" ADD CONSTRAINT "LoanProductAccountingMapping_interestIncomeAccountId_fkey" FOREIGN KEY ("interestIncomeAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanProductAccountingMapping" ADD CONSTRAINT "LoanProductAccountingMapping_feeIncomeAccountId_fkey" FOREIGN KEY ("feeIncomeAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanProductAccountingMapping" ADD CONSTRAINT "LoanProductAccountingMapping_penaltyIncomeAccountId_fkey" FOREIGN KEY ("penaltyIncomeAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanProductAccountingMapping" ADD CONSTRAINT "LoanProductAccountingMapping_writeOffExpenseAccountId_fkey" FOREIGN KEY ("writeOffExpenseAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanProductAccountingMapping" ADD CONSTRAINT "LoanProductAccountingMapping_overpaymentLiabilityAccountId_fkey" FOREIGN KEY ("overpaymentLiabilityAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SettlementAccountMapping" ADD CONSTRAINT "SettlementAccountMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SettlementAccountMapping" ADD CONSTRAINT "SettlementAccountMapping_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
