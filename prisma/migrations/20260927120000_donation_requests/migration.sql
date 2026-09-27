-- CreateEnum
CREATE TYPE "DonationRequestStatus" AS ENUM ('PENDING', 'SUCCEEDED');

-- CreateTable
CREATE TABLE "DonationRequest" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT,
    "moreBiodata" BOOLEAN NOT NULL DEFAULT false,
    "country" TEXT,
    "phone" TEXT,
    "city" TEXT,
    "status" "DonationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "succeededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DonationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DonationRequest_status_createdAt_idx" ON "DonationRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DonationRequest_email_idx" ON "DonationRequest"("email");
