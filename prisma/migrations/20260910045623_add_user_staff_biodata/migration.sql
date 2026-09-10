-- AlterTable
ALTER TABLE "public"."user" ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "externalStaffId" TEXT,
ADD COLUMN     "genderCode" TEXT,
ADD COLUMN     "joinedOn" DATE,
ADD COLUMN     "mobileNumber" TEXT;
