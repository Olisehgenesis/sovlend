-- CreateTable
CREATE TABLE "public"."Guarantor" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "externalId" INTEGER,
    "guarantorType" TEXT NOT NULL DEFAULT 'EXTERNAL',
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "relationship" TEXT,
    "dateOfBirth" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guarantor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Guarantor_externalId_key" ON "public"."Guarantor"("externalId");

-- CreateIndex
CREATE INDEX "Guarantor_loanId_idx" ON "public"."Guarantor"("loanId");

-- AddForeignKey
ALTER TABLE "public"."Guarantor" ADD CONSTRAINT "Guarantor_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "public"."Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
