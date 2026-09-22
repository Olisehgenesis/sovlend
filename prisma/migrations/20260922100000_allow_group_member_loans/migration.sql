-- Group-member loans are issued to an individual in a selected group, so both
-- clientId and groupId may be set together. A loan still needs at least one owner.
ALTER TABLE "public"."Loan" DROP CONSTRAINT "Loan_owner_xor_check";
ALTER TABLE "public"."LoanApplication" DROP CONSTRAINT "LoanApplication_owner_xor_check";

ALTER TABLE "public"."Loan" ADD CONSTRAINT "Loan_owner_present_check"
  CHECK ("clientId" IS NOT NULL OR "groupId" IS NOT NULL);

ALTER TABLE "public"."LoanApplication" ADD CONSTRAINT "LoanApplication_owner_present_check"
  CHECK ("clientId" IS NOT NULL OR "groupId" IS NOT NULL);
