-- AlterTable
ALTER TABLE "DonationRequest" ADD COLUMN "amountUsdMinor" BIGINT,
ADD COLUMN "amountSats" BIGINT;

-- CreateTable
CREATE TABLE "DonationLightningInvoice" (
    "id" UUID NOT NULL,
    "donationRequestId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerInvoiceId" TEXT NOT NULL,
    "bolt11" TEXT NOT NULL,
    "paymentHash" TEXT,
    "amountUsdMinor" BIGINT NOT NULL,
    "amountSats" BIGINT NOT NULL,
    "status" "LightningInvoiceStatus" NOT NULL DEFAULT 'NEW',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DonationLightningInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DonationLightningInvoice_providerInvoiceId_key" ON "DonationLightningInvoice"("providerInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "DonationLightningInvoice_paymentHash_key" ON "DonationLightningInvoice"("paymentHash");

-- CreateIndex
CREATE INDEX "DonationLightningInvoice_donationRequestId_createdAt_idx" ON "DonationLightningInvoice"("donationRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "DonationLightningInvoice_status_expiresAt_idx" ON "DonationLightningInvoice"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "DonationLightningInvoice" ADD CONSTRAINT "DonationLightningInvoice_donationRequestId_fkey" FOREIGN KEY ("donationRequestId") REFERENCES "DonationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
