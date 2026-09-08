-- AlterTable
ALTER TABLE "public"."LoanApplication" ADD COLUMN     "applicationExpiresOn" DATE,
ADD COLUMN     "chargesSnapshot" JSONB,
ADD COLUMN     "collateralSnapshot" JSONB,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "fund" TEXT,
ADD COLUMN     "loanOfficerId" TEXT,
ADD COLUMN     "termsSnapshot" JSONB;

-- CreateTable
CREATE TABLE "public"."LoanApplicationDocument" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "uploadedById" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "objectKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanApplicationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LoanApplicationNote" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanApplicationNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoanApplicationDocument_objectKey_key" ON "public"."LoanApplicationDocument"("objectKey");

-- CreateIndex
CREATE INDEX "LoanApplicationDocument_applicationId_idx" ON "public"."LoanApplicationDocument"("applicationId");

-- CreateIndex
CREATE INDEX "LoanApplicationNote_applicationId_idx" ON "public"."LoanApplicationNote"("applicationId");

-- CreateIndex
CREATE INDEX "LoanApplication_loanOfficerId_status_idx" ON "public"."LoanApplication"("loanOfficerId", "status");

-- AddForeignKey
ALTER TABLE "public"."LoanApplication" ADD CONSTRAINT "LoanApplication_loanOfficerId_fkey" FOREIGN KEY ("loanOfficerId") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanApplicationDocument" ADD CONSTRAINT "LoanApplicationDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "public"."LoanApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanApplicationDocument" ADD CONSTRAINT "LoanApplicationDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanApplicationNote" ADD CONSTRAINT "LoanApplicationNote_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "public"."LoanApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanApplicationNote" ADD CONSTRAINT "LoanApplicationNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
