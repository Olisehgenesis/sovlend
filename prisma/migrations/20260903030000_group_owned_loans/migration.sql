-- DropForeignKey
ALTER TABLE "public"."Loan" DROP CONSTRAINT "Loan_clientId_fkey";

-- DropForeignKey
ALTER TABLE "public"."LoanApplication" DROP CONSTRAINT "LoanApplication_clientId_fkey";

-- AlterTable
ALTER TABLE "public"."Loan" ADD COLUMN     "groupId" UUID,
ALTER COLUMN "clientId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."LoanApplication" ADD COLUMN     "groupId" UUID,
ADD COLUMN     "officeId" UUID NOT NULL,
ALTER COLUMN "clientId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Loan_groupId_status_idx" ON "public"."Loan"("groupId", "status");

-- CreateIndex
CREATE INDEX "LoanApplication_groupId_status_idx" ON "public"."LoanApplication"("groupId", "status");

-- CreateIndex
CREATE INDEX "LoanApplication_officeId_status_idx" ON "public"."LoanApplication"("officeId", "status");

-- AddForeignKey
ALTER TABLE "public"."LoanApplication" ADD CONSTRAINT "LoanApplication_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanApplication" ADD CONSTRAINT "LoanApplication_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanApplication" ADD CONSTRAINT "LoanApplication_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "public"."Office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Loan" ADD CONSTRAINT "Loan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Loan" ADD CONSTRAINT "Loan_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CheckConstraint: a loan/loan application is owned by exactly one of an individual Client or a
-- collective Group (never both, never neither) so group-owned lending (SACCO-style groups that
-- save/borrow together) can be represented alongside individual-client lending.
ALTER TABLE "public"."Loan" ADD CONSTRAINT "Loan_owner_xor_check"
  CHECK ((("clientId" IS NOT NULL)::int + ("groupId" IS NOT NULL)::int) = 1);

ALTER TABLE "public"."LoanApplication" ADD CONSTRAINT "LoanApplication_owner_xor_check"
  CHECK ((("clientId" IS NOT NULL)::int + ("groupId" IS NOT NULL)::int) = 1);

-- AlterTable: loan charges may also belong to a group (a charge on a group-owned loan/account)
ALTER TABLE "public"."Charge" ADD COLUMN     "groupId" UUID,
ALTER COLUMN "clientId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Charge_groupId_status_idx" ON "public"."Charge"("groupId", "status");

-- AddForeignKey
ALTER TABLE "public"."Charge" ADD CONSTRAINT "Charge_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
