-- CreateTable
CREATE TABLE "public"."ProvisioningAccountingDefaults" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "provisionExpenseAccountId" UUID,
    "loanLossProvisionAccountId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProvisioningAccountingDefaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProvisioningPosting" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "asOfDate" DATE NOT NULL,
    "requiredProvisionMinor" BIGINT NOT NULL,
    "previousProvisionMinor" BIGINT NOT NULL,
    "deltaMinor" BIGINT NOT NULL,
    "journalId" UUID,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProvisioningPosting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProvisioningAccountingDefaults_organizationId_key" ON "public"."ProvisioningAccountingDefaults"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProvisioningPosting_journalId_key" ON "public"."ProvisioningPosting"("journalId");

-- CreateIndex
CREATE INDEX "ProvisioningPosting_officeId_asOfDate_idx" ON "public"."ProvisioningPosting"("officeId", "asOfDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProvisioningPosting_officeId_asOfDate_key" ON "public"."ProvisioningPosting"("officeId", "asOfDate");

-- AddForeignKey
ALTER TABLE "public"."ProvisioningAccountingDefaults" ADD CONSTRAINT "ProvisioningAccountingDefaults_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProvisioningAccountingDefaults" ADD CONSTRAINT "ProvisioningAccountingDefaults_provisionExpenseAccountId_fkey" FOREIGN KEY ("provisionExpenseAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProvisioningAccountingDefaults" ADD CONSTRAINT "ProvisioningAccountingDefaults_loanLossProvisionAccountId_fkey" FOREIGN KEY ("loanLossProvisionAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProvisioningPosting" ADD CONSTRAINT "ProvisioningPosting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProvisioningPosting" ADD CONSTRAINT "ProvisioningPosting_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "public"."Office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProvisioningPosting" ADD CONSTRAINT "ProvisioningPosting_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "public"."Journal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProvisioningPosting" ADD CONSTRAINT "ProvisioningPosting_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
