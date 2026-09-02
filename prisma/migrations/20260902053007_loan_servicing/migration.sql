/*
  Warnings:

  - Added the required column `settlementChannel` to the `LoanTransaction` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."LoanTransaction" ADD COLUMN     "settlementChannel" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "public"."LoanTransactionAllocation" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "installmentId" UUID NOT NULL,
    "principalMinor" BIGINT NOT NULL DEFAULT 0,
    "interestMinor" BIGINT NOT NULL DEFAULT 0,
    "feesMinor" BIGINT NOT NULL DEFAULT 0,
    "penaltiesMinor" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanTransactionAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoanTransactionAllocation_installmentId_idx" ON "public"."LoanTransactionAllocation"("installmentId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanTransactionAllocation_transactionId_installmentId_key" ON "public"."LoanTransactionAllocation"("transactionId", "installmentId");

-- AddForeignKey
ALTER TABLE "public"."LoanTransactionAllocation" ADD CONSTRAINT "LoanTransactionAllocation_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "public"."LoanTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanTransactionAllocation" ADD CONSTRAINT "LoanTransactionAllocation_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "public"."LoanInstallment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
