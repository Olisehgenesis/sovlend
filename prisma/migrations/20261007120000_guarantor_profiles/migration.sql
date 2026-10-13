CREATE TABLE "GuarantorProfile" (
  "id" UUID NOT NULL, "applicationId" UUID NOT NULL, "clientId" UUID,
  "firstName" TEXT NOT NULL, "lastName" TEXT NOT NULL, "phone" TEXT NOT NULL,
  "relationship" TEXT, "dateOfBirth" DATE, "gender" TEXT, "nationalId" TEXT,
  "address" TEXT, "occupation" TEXT, "employer" TEXT, "bio" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GuarantorProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GuarantorProfile_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LoanApplication"("id"),
  CONSTRAINT "GuarantorProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id")
);
CREATE INDEX "GuarantorProfile_applicationId_idx" ON "GuarantorProfile"("applicationId");
CREATE INDEX "GuarantorProfile_clientId_idx" ON "GuarantorProfile"("clientId");
CREATE TABLE "GuarantorDocument" (
  "id" UUID NOT NULL, "profileId" UUID NOT NULL, "uploadedById" TEXT NOT NULL,
  "name" TEXT NOT NULL, "sha256" TEXT NOT NULL, "mediaType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuarantorDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GuarantorDocument_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "GuarantorProfile"("id")
);
CREATE INDEX "GuarantorDocument_profileId_idx" ON "GuarantorDocument"("profileId");
ALTER TABLE "Guarantor" ADD COLUMN "profileId" UUID;
ALTER TABLE "Guarantor" ADD CONSTRAINT "Guarantor_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "GuarantorProfile"("id");
INSERT INTO "GuarantorProfile" ("id", "applicationId", "firstName", "lastName", "phone", "relationship", "dateOfBirth", "updatedAt")
SELECT gen_random_uuid(), a."id", p->>'firstName', p->>'lastName', p->>'phone', p->>'relationship', (p->>'dateOfBirth')::date, CURRENT_TIMESTAMP
FROM "LoanApplication" a CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a."guarantorsSnapshot", '[]'::jsonb)) p;
UPDATE "Guarantor" g SET "profileId" = p."id"
FROM "GuarantorProfile" p, "Loan" l
WHERE g."loanId" = l."id" AND l."applicationId" = p."applicationId"
AND g."firstName" = p."firstName" AND g."lastName" = p."lastName" AND g."phone" = p."phone";
