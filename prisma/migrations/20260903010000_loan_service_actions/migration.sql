-- AlterTable
ALTER TABLE "public"."LoanInstallment" ADD COLUMN     "feesWaivedMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "interestWaivedMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "penaltiesWaivedMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "principalWaivedMinor" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "public"."LoanServiceRequest" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "actionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "payload" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "resultTransactionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoanServiceRequest_idempotencyKey_key" ON "public"."LoanServiceRequest"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "LoanServiceRequest_resultTransactionId_key" ON "public"."LoanServiceRequest"("resultTransactionId");

-- CreateIndex
CREATE INDEX "LoanServiceRequest_loanId_status_idx" ON "public"."LoanServiceRequest"("loanId", "status");

-- CreateIndex
CREATE INDEX "LoanServiceRequest_loanId_actionType_idx" ON "public"."LoanServiceRequest"("loanId", "actionType");

-- AddForeignKey
ALTER TABLE "public"."LoanServiceRequest" ADD CONSTRAINT "LoanServiceRequest_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "public"."Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanServiceRequest" ADD CONSTRAINT "LoanServiceRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanServiceRequest" ADD CONSTRAINT "LoanServiceRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanServiceRequest" ADD CONSTRAINT "LoanServiceRequest_resultTransactionId_fkey" FOREIGN KEY ("resultTransactionId") REFERENCES "public"."LoanTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

