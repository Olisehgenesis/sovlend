-- AlterEnum
ALTER TYPE "public"."ReminderType" ADD VALUE 'STANDING_ORDER_SWEPT';

-- AlterEnum
ALTER TYPE "public"."UserRole" ADD VALUE 'SYSTEM';

-- AlterTable
ALTER TABLE "public"."SavingsAccount" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;
