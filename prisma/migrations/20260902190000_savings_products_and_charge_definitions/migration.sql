-- CreateTable
CREATE TABLE "public"."SavingsProduct" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "description" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'UGX',
    "nominalAnnualRateBps" INTEGER NOT NULL DEFAULT 0,
    "minOpeningBalanceMinor" BIGINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavingsProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ChargeDefinition" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "appliesTo" TEXT NOT NULL,
    "calculationType" TEXT NOT NULL,
    "amountMinor" BIGINT,
    "percentageBps" INTEGER,
    "currencyCode" TEXT NOT NULL DEFAULT 'UGX',
    "penalty" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargeDefinition_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "public"."Charge" ADD COLUMN     "chargeDefinitionId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "SavingsProduct_organizationId_shortName_key" ON "public"."SavingsProduct"("organizationId", "shortName");

-- CreateIndex
CREATE INDEX "SavingsProduct_organizationId_active_idx" ON "public"."SavingsProduct"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeDefinition_organizationId_name_key" ON "public"."ChargeDefinition"("organizationId", "name");

-- CreateIndex
CREATE INDEX "ChargeDefinition_organizationId_active_idx" ON "public"."ChargeDefinition"("organizationId", "active");

-- CreateIndex
CREATE INDEX "Charge_chargeDefinitionId_idx" ON "public"."Charge"("chargeDefinitionId");

-- AddForeignKey
ALTER TABLE "public"."SavingsProduct" ADD CONSTRAINT "SavingsProduct_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ChargeDefinition" ADD CONSTRAINT "ChargeDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Charge" ADD CONSTRAINT "Charge_chargeDefinitionId_fkey" FOREIGN KEY ("chargeDefinitionId") REFERENCES "public"."ChargeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
