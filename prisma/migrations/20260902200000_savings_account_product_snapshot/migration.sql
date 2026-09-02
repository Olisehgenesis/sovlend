-- AlterTable
ALTER TABLE "public"."SavingsAccount" ADD COLUMN     "productId" UUID,
ADD COLUMN     "termsSnapshot" JSONB;

-- CreateIndex
CREATE INDEX "SavingsAccount_productId_idx" ON "public"."SavingsAccount"("productId");

-- AddForeignKey
ALTER TABLE "public"."SavingsAccount" ADD CONSTRAINT "SavingsAccount_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."SavingsProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
