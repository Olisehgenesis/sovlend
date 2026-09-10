-- CreateTable
CREATE TABLE "public"."OpeningBalanceAccountingDefaults" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "openingBalanceEquityAccountId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningBalanceAccountingDefaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OpeningBalanceMigration" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "ledgerAccountId" UUID NOT NULL,
    "asOfDate" DATE NOT NULL,
    "direction" "public"."EntryDirection" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "journalId" UUID NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpeningBalanceMigration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpeningBalanceAccountingDefaults_organizationId_key" ON "public"."OpeningBalanceAccountingDefaults"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningBalanceMigration_journalId_key" ON "public"."OpeningBalanceMigration"("journalId");

-- CreateIndex
CREATE INDEX "OpeningBalanceMigration_officeId_ledgerAccountId_idx" ON "public"."OpeningBalanceMigration"("officeId", "ledgerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningBalanceMigration_officeId_ledgerAccountId_key" ON "public"."OpeningBalanceMigration"("officeId", "ledgerAccountId");

-- AddForeignKey
ALTER TABLE "public"."OpeningBalanceAccountingDefaults" ADD CONSTRAINT "OpeningBalanceAccountingDefaults_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OpeningBalanceAccountingDefaults" ADD CONSTRAINT "OpeningBalanceAccountingDefaults_openingBalanceEquityAccou_fkey" FOREIGN KEY ("openingBalanceEquityAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OpeningBalanceMigration" ADD CONSTRAINT "OpeningBalanceMigration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OpeningBalanceMigration" ADD CONSTRAINT "OpeningBalanceMigration_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "public"."Office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OpeningBalanceMigration" ADD CONSTRAINT "OpeningBalanceMigration_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OpeningBalanceMigration" ADD CONSTRAINT "OpeningBalanceMigration_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "public"."Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OpeningBalanceMigration" ADD CONSTRAINT "OpeningBalanceMigration_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
