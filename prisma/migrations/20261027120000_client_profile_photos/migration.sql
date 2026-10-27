ALTER TABLE "Document" ADD COLUMN "isProfilePhoto" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Document" AS document
SET "isProfilePhoto" = true
FROM "Client" AS client
WHERE client."photoDocumentId" = document.id;
