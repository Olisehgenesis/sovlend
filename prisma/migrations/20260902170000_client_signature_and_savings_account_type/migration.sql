-- AlterTable
ALTER TABLE "public"."Client" ADD COLUMN     "signatureDocumentId" UUID;

-- AlterTable
ALTER TABLE "public"."SavingsAccount" ADD COLUMN     "accountType" TEXT NOT NULL DEFAULT 'SAVINGS';

-- CreateIndex
CREATE UNIQUE INDEX "Client_signatureDocumentId_key" ON "public"."Client"("signatureDocumentId");

-- AddForeignKey
ALTER TABLE "public"."Client" ADD CONSTRAINT "Client_signatureDocumentId_fkey" FOREIGN KEY ("signatureDocumentId") REFERENCES "public"."Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
