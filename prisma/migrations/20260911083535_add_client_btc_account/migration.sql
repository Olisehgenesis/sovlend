-- CreateTable
CREATE TABLE "ClientBtcAccount" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "balanceSource" TEXT NOT NULL DEFAULT 'MANUAL',
    "address" TEXT,
    "manualBalanceSats" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientBtcAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientBtcAccount_organizationId_status_idx" ON "ClientBtcAccount"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ClientBtcAccount_clientId_idx" ON "ClientBtcAccount"("clientId");

-- AddForeignKey
ALTER TABLE "ClientBtcAccount" ADD CONSTRAINT "ClientBtcAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBtcAccount" ADD CONSTRAINT "ClientBtcAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
