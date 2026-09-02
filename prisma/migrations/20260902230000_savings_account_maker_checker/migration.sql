-- AlterTable
ALTER TABLE "public"."SavingsAccount" ADD COLUMN     "submittedById" TEXT,
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "approvedOn" DATE;

-- AddForeignKey
ALTER TABLE "public"."SavingsAccount" ADD CONSTRAINT "SavingsAccount_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SavingsAccount" ADD CONSTRAINT "SavingsAccount_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
