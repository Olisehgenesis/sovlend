-- AlterTable
ALTER TABLE "public"."Document" ADD COLUMN     "identifierId" UUID;

-- AlterTable
ALTER TABLE "public"."Client" ADD COLUMN     "photoDocumentId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "Client_photoDocumentId_key" ON "public"."Client"("photoDocumentId");

-- CreateIndex
CREATE INDEX "Document_identifierId_idx" ON "public"."Document"("identifierId");

-- AddForeignKey
ALTER TABLE "public"."Document" ADD CONSTRAINT "Document_identifierId_fkey" FOREIGN KEY ("identifierId") REFERENCES "public"."ClientIdentifier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Client" ADD CONSTRAINT "Client_photoDocumentId_fkey" FOREIGN KEY ("photoDocumentId") REFERENCES "public"."Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
