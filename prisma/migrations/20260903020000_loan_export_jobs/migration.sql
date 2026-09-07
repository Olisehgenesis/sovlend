-- CreateTable
CREATE TABLE "public"."LoanExportJob" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requestedById" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeParams" JSONB NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "asOfDate" DATE NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "manifest" JSONB,
    "resultObjectKey" TEXT,
    "resultByteSize" INTEGER,
    "resultSha256" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoanExportJob_idempotencyKey_key" ON "public"."LoanExportJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LoanExportJob_organizationId_status_idx" ON "public"."LoanExportJob"("organizationId", "status");

-- CreateIndex
CREATE INDEX "LoanExportJob_requestedById_idx" ON "public"."LoanExportJob"("requestedById");

-- AddForeignKey
ALTER TABLE "public"."LoanExportJob" ADD CONSTRAINT "LoanExportJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanExportJob" ADD CONSTRAINT "LoanExportJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

