-- AlterTable
ALTER TABLE "public"."Document" ADD COLUMN     "familyMemberId" UUID;

-- CreateIndex
CREATE INDEX "Document_familyMemberId_idx" ON "public"."Document"("familyMemberId");

-- AddForeignKey
ALTER TABLE "public"."Document" ADD CONSTRAINT "Document_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "public"."ClientFamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
