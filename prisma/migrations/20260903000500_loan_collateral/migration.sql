-- CreateTable
CREATE TABLE "public"."LoanCollateral" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "estimatedValueMinor" BIGINT,
    "valuationCurrencyCode" TEXT NOT NULL DEFAULT 'UGX',
    "valuationDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanCollateral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoanCollateral_loanId_status_idx" ON "public"."LoanCollateral"("loanId", "status");

-- CreateIndex
CREATE INDEX "LoanCollateral_loanId_valuationDate_idx" ON "public"."LoanCollateral"("loanId", "valuationDate");

-- AddForeignKey
ALTER TABLE "public"."LoanCollateral" ADD CONSTRAINT "LoanCollateral_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "public"."Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
