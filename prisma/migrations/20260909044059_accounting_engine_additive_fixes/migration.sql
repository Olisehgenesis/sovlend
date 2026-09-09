-- AlterTable
ALTER TABLE "public"."LoanInstallment" ADD COLUMN     "monitoringFeeDueMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "monitoringFeePaidMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "monitoringFeeWaivedMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "penaltyAssessedOn" DATE;

-- AlterTable
ALTER TABLE "public"."LoanProductAccountingMapping" ADD COLUMN     "admissionFeeIncomeAccountId" UUID,
ADD COLUMN     "monitoringFeeIncomeAccountId" UUID,
ADD COLUMN     "penaltyReceivableAccountId" UUID,
ADD COLUMN     "processingFeeIncomeAccountId" UUID;

-- CreateTable
CREATE TABLE "public"."SavingsProductAccountingMapping" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "savingsLiabilityAccountId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavingsProductAccountingMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SavingsAccountingDefaults" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "savingsLiabilityAccountId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavingsAccountingDefaults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SavingsProductAccountingMapping_productId_key" ON "public"."SavingsProductAccountingMapping"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SavingsAccountingDefaults_organizationId_key" ON "public"."SavingsAccountingDefaults"("organizationId");

-- AddForeignKey
ALTER TABLE "public"."LoanProductAccountingMapping" ADD CONSTRAINT "LoanProductAccountingMapping_monitoringFeeIncomeAccountId_fkey" FOREIGN KEY ("monitoringFeeIncomeAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanProductAccountingMapping" ADD CONSTRAINT "LoanProductAccountingMapping_processingFeeIncomeAccountId_fkey" FOREIGN KEY ("processingFeeIncomeAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanProductAccountingMapping" ADD CONSTRAINT "LoanProductAccountingMapping_admissionFeeIncomeAccountId_fkey" FOREIGN KEY ("admissionFeeIncomeAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanProductAccountingMapping" ADD CONSTRAINT "LoanProductAccountingMapping_penaltyReceivableAccountId_fkey" FOREIGN KEY ("penaltyReceivableAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SavingsProductAccountingMapping" ADD CONSTRAINT "SavingsProductAccountingMapping_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."SavingsProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SavingsProductAccountingMapping" ADD CONSTRAINT "SavingsProductAccountingMapping_savingsLiabilityAccountId_fkey" FOREIGN KEY ("savingsLiabilityAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SavingsAccountingDefaults" ADD CONSTRAINT "SavingsAccountingDefaults_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SavingsAccountingDefaults" ADD CONSTRAINT "SavingsAccountingDefaults_savingsLiabilityAccountId_fkey" FOREIGN KEY ("savingsLiabilityAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
