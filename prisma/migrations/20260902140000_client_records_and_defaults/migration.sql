-- DropIndex
DROP INDEX "public"."SettlementAccountMapping_organizationId_channel_currencyCod_key";

-- AlterTable
ALTER TABLE "public"."LoanTransaction" ADD COLUMN     "settlementAccountId" UUID;

-- AlterTable
ALTER TABLE "public"."Organization" ADD COLUMN     "nextClientSequence" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "public"."SettlementAccountMapping" DROP COLUMN "channel",
ADD COLUMN     "accountReference" TEXT,
ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "type" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "public"."ClientFamilyMember" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "qualification" TEXT,
    "mobileNumber" TEXT,
    "age" INTEGER,
    "isDependent" BOOLEAN NOT NULL DEFAULT false,
    "relationship" TEXT,
    "genderCode" TEXT,
    "profession" TEXT,
    "maritalStatus" TEXT,
    "dateOfBirth" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientFamilyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ClientIdentifier" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "documentType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "uniqueNumber" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ClientNote" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LoanAccountingDefaults" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "principalReceivableAccountId" UUID,
    "interestIncomeAccountId" UUID,
    "feeIncomeAccountId" UUID,
    "penaltyIncomeAccountId" UUID,
    "writeOffExpenseAccountId" UUID,
    "overpaymentLiabilityAccountId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanAccountingDefaults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientFamilyMember_clientId_idx" ON "public"."ClientFamilyMember"("clientId");

-- CreateIndex
CREATE INDEX "ClientIdentifier_clientId_idx" ON "public"."ClientIdentifier"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientIdentifier_clientId_documentType_uniqueNumber_key" ON "public"."ClientIdentifier"("clientId", "documentType", "uniqueNumber");

-- CreateIndex
CREATE INDEX "ClientNote_clientId_idx" ON "public"."ClientNote"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanAccountingDefaults_organizationId_key" ON "public"."LoanAccountingDefaults"("organizationId");

-- CreateIndex
CREATE INDEX "LoanTransaction_settlementAccountId_idx" ON "public"."LoanTransaction"("settlementAccountId");

-- CreateIndex
CREATE INDEX "SettlementAccountMapping_organizationId_type_active_idx" ON "public"."SettlementAccountMapping"("organizationId", "type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementAccountMapping_organizationId_name_currencyCode_key" ON "public"."SettlementAccountMapping"("organizationId", "name", "currencyCode");

-- AddForeignKey
ALTER TABLE "public"."ClientFamilyMember" ADD CONSTRAINT "ClientFamilyMember_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClientIdentifier" ADD CONSTRAINT "ClientIdentifier_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClientNote" ADD CONSTRAINT "ClientNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClientNote" ADD CONSTRAINT "ClientNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanTransaction" ADD CONSTRAINT "LoanTransaction_settlementAccountId_fkey" FOREIGN KEY ("settlementAccountId") REFERENCES "public"."SettlementAccountMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanAccountingDefaults" ADD CONSTRAINT "LoanAccountingDefaults_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanAccountingDefaults" ADD CONSTRAINT "LoanAccountingDefaults_principalReceivableAccountId_fkey" FOREIGN KEY ("principalReceivableAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanAccountingDefaults" ADD CONSTRAINT "LoanAccountingDefaults_interestIncomeAccountId_fkey" FOREIGN KEY ("interestIncomeAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanAccountingDefaults" ADD CONSTRAINT "LoanAccountingDefaults_feeIncomeAccountId_fkey" FOREIGN KEY ("feeIncomeAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanAccountingDefaults" ADD CONSTRAINT "LoanAccountingDefaults_penaltyIncomeAccountId_fkey" FOREIGN KEY ("penaltyIncomeAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanAccountingDefaults" ADD CONSTRAINT "LoanAccountingDefaults_writeOffExpenseAccountId_fkey" FOREIGN KEY ("writeOffExpenseAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanAccountingDefaults" ADD CONSTRAINT "LoanAccountingDefaults_overpaymentLiabilityAccountId_fkey" FOREIGN KEY ("overpaymentLiabilityAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
