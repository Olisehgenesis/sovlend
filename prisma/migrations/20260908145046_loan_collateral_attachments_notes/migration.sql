-- AlterTable
ALTER TABLE "public"."Document" ADD COLUMN     "collateralId" UUID;

-- AlterTable
ALTER TABLE "public"."LoanNote" ADD COLUMN     "collateralId" UUID;

-- CreateIndex
CREATE INDEX "Document_collateralId_idx" ON "public"."Document"("collateralId");

-- CreateIndex
CREATE INDEX "LoanNote_collateralId_idx" ON "public"."LoanNote"("collateralId");

-- AddForeignKey
ALTER TABLE "public"."LoanNote" ADD CONSTRAINT "LoanNote_collateralId_fkey" FOREIGN KEY ("collateralId") REFERENCES "public"."LoanCollateral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Document" ADD CONSTRAINT "Document_collateralId_fkey" FOREIGN KEY ("collateralId") REFERENCES "public"."LoanCollateral"("id") ON DELETE SET NULL ON UPDATE CASCADE;
