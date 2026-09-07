-- DropForeignKey
ALTER TABLE "public"."SavingsAccount" DROP CONSTRAINT "SavingsAccount_clientId_fkey";

-- AlterTable
ALTER TABLE "public"."SavingsAccount" ADD COLUMN     "groupId" UUID,
ALTER COLUMN "clientId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "SavingsAccount_groupId_status_idx" ON "public"."SavingsAccount"("groupId", "status");

-- AddForeignKey
ALTER TABLE "public"."SavingsAccount" ADD CONSTRAINT "SavingsAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SavingsAccount" ADD CONSTRAINT "SavingsAccount_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
