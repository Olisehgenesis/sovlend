-- AlterTable
ALTER TABLE "public"."Loan" ADD COLUMN     "feesWrittenOffMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "interestWrittenOffMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "penaltiesWrittenOffMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "principalWrittenOffMinor" BIGINT NOT NULL DEFAULT 0;
