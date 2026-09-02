-- CreateEnum
CREATE TYPE "public"."GroupStatus" AS ENUM ('PENDING', 'ACTIVE', 'CLOSED');

-- AlterTable
ALTER TABLE "public"."Organization" ADD COLUMN     "nextGroupSequence" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "public"."Group" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "staffId" TEXT,
    "accountNumber" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "status" "public"."GroupStatus" NOT NULL DEFAULT 'PENDING',
    "submittedOn" DATE,
    "activatedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GroupMember" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "joinedOn" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GroupNote" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Group_organizationId_officeId_status_idx" ON "public"."Group"("organizationId", "officeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Group_organizationId_accountNumber_key" ON "public"."Group"("organizationId", "accountNumber");

-- CreateIndex
CREATE INDEX "GroupMember_clientId_idx" ON "public"."GroupMember"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_groupId_clientId_key" ON "public"."GroupMember"("groupId", "clientId");

-- CreateIndex
CREATE INDEX "GroupNote_groupId_idx" ON "public"."GroupNote"("groupId");

-- AddForeignKey
ALTER TABLE "public"."Group" ADD CONSTRAINT "Group_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Group" ADD CONSTRAINT "Group_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "public"."Office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Group" ADD CONSTRAINT "Group_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GroupMember" ADD CONSTRAINT "GroupMember_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GroupNote" ADD CONSTRAINT "GroupNote_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GroupNote" ADD CONSTRAINT "GroupNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
