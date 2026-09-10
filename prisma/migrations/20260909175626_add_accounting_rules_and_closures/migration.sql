-- CreateTable
CREATE TABLE "public"."AccountingRule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "officeId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AccountingRuleAccount" (
    "id" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "side" "public"."EntryDirection" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingRuleAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AccountingClosure" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "closingDate" DATE NOT NULL,
    "comment" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingClosure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountingRule_organizationId_active_idx" ON "public"."AccountingRule"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingRule_organizationId_name_key" ON "public"."AccountingRule"("organizationId", "name");

-- CreateIndex
CREATE INDEX "AccountingRuleAccount_ruleId_side_idx" ON "public"."AccountingRuleAccount"("ruleId", "side");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingRuleAccount_ruleId_accountId_side_key" ON "public"."AccountingRuleAccount"("ruleId", "accountId", "side");

-- CreateIndex
CREATE INDEX "AccountingClosure_officeId_closingDate_idx" ON "public"."AccountingClosure"("officeId", "closingDate");

-- AddForeignKey
ALTER TABLE "public"."AccountingRule" ADD CONSTRAINT "AccountingRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AccountingRule" ADD CONSTRAINT "AccountingRule_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "public"."Office"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AccountingRuleAccount" ADD CONSTRAINT "AccountingRuleAccount_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "public"."AccountingRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AccountingRuleAccount" ADD CONSTRAINT "AccountingRuleAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AccountingClosure" ADD CONSTRAINT "AccountingClosure_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AccountingClosure" ADD CONSTRAINT "AccountingClosure_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "public"."Office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AccountingClosure" ADD CONSTRAINT "AccountingClosure_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
