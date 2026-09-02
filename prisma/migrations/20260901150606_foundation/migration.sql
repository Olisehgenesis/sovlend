-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('ADMIN', 'TELLER', 'LOAN_OFFICER', 'CLIENT', 'INVESTOR', 'TREASURY_SIGNER', 'AUDITOR');

-- CreateEnum
CREATE TYPE "public"."ClientStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'ACTIVE', 'INACTIVE', 'CLOSED', 'REJECTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "public"."KycStatus" AS ENUM ('INCOMPLETE', 'SUBMITTED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."LoanApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'DISBURSED');

-- CreateEnum
CREATE TYPE "public"."LoanStatus" AS ENUM ('APPROVED', 'ACTIVE', 'IN_ARREARS', 'OVERPAID', 'WRITTEN_OFF', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "public"."EntryDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "public"."JournalStatus" AS ENUM ('PENDING', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "public"."OwnershipType" AS ENUM ('INVESTOR_CAPITAL', 'CLIENT_SAVINGS', 'COMPANY_TREASURY', 'OPERATING_FUNDS');

-- CreateEnum
CREATE TYPE "public"."WalletKind" AS ENUM ('HOT', 'COLD_MULTISIG', 'DEPOSIT');

-- CreateEnum
CREATE TYPE "public"."WalletNetwork" AS ENUM ('BITCOIN', 'EVM');

-- CreateEnum
CREATE TYPE "public"."ProposalStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'BROADCAST', 'CONFIRMED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."PriceStatus" AS ENUM ('QUORUM', 'DEGRADED', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."ReminderType" AS ENUM ('REPAYMENT_DUE_SOON', 'REPAYMENT_DUE_TODAY', 'REPAYMENT_OVERDUE');

-- CreateEnum
CREATE TYPE "public"."ReminderStatus" AS ENUM ('SCHEDULED', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."PermissionScope" AS ENUM ('ORGANIZATION', 'OFFICE', 'OWN');

-- CreateEnum
CREATE TYPE "public"."InvestorAccessStatus" AS ENUM ('REQUESTED', 'INVITED', 'ACTIVE', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "public"."InvestmentStatus" AS ENUM ('DRAFT', 'AWAITING_INVOICE', 'AWAITING_PAYMENT', 'SETTLEMENT_PENDING', 'FUNDED', 'EXPIRED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "public"."LightningInvoiceStatus" AS ENUM ('NEW', 'PAID', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."MigrationRunStatus" AS ENUM ('CREATED', 'EXTRACTING', 'EXTRACTED', 'IMPORTING', 'RECONCILING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "public"."Organization" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'UGX',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Office" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Office_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" TEXT,
    "banned" BOOLEAN DEFAULT false,
    "banReason" TEXT,
    "banExpires" TIMESTAMP(3),
    "organizationId" UUID,
    "officeId" UUID,
    "systemRole" "public"."UserRole" NOT NULL DEFAULT 'CLIENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "impersonatedBy" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."account" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."passkey" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "publicKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialID" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "transports" TEXT,
    "createdAt" TIMESTAMP(3),
    "aaguid" TEXT,

    CONSTRAINT "passkey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Currency" (
    "code" VARCHAR(10) NOT NULL,
    "name" TEXT NOT NULL,
    "exponent" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "public"."Client" (
    "id" UUID NOT NULL,
    "authUserId" TEXT,
    "organizationId" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "assignedOfficerId" TEXT,
    "accountNumber" TEXT NOT NULL,
    "externalId" TEXT,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "mobileNumber" TEXT,
    "dateOfBirth" DATE,
    "genderCode" TEXT,
    "clientTypeCode" TEXT,
    "classificationCode" TEXT,
    "isStaff" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."ClientStatus" NOT NULL DEFAULT 'DRAFT',
    "kycStatus" "public"."KycStatus" NOT NULL DEFAULT 'INCOMPLETE',
    "submittedOn" DATE,
    "activatedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LoanProduct" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "denominationCurrency" TEXT NOT NULL DEFAULT 'UGX',
    "principalMinMinor" BIGINT NOT NULL,
    "principalMaxMinor" BIGINT NOT NULL,
    "annualRateBps" INTEGER NOT NULL,
    "repaymentCount" INTEGER NOT NULL,
    "repaymentFrequency" TEXT NOT NULL,
    "amortizationMethod" TEXT NOT NULL,
    "interestMethod" TEXT NOT NULL,
    "lateFeeRule" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LoanApplication" (
    "id" UUID NOT NULL,
    "submittedById" TEXT,
    "clientId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "proposedPrincipalMinor" BIGINT NOT NULL,
    "approvedPrincipalMinor" BIGINT,
    "status" "public"."LoanApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "purpose" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PermissionDefinition" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionDefinition_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "public"."PermissionGroup" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PermissionGroupPermission" (
    "groupId" UUID NOT NULL,
    "permissionCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionGroupPermission_pkey" PRIMARY KEY ("groupId","permissionCode")
);

-- CreateTable
CREATE TABLE "public"."UserPermissionAssignment" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" UUID NOT NULL,
    "scope" "public"."PermissionScope" NOT NULL,
    "officeId" UUID,
    "includeChildOffices" BOOLEAN NOT NULL DEFAULT false,
    "approvalLimitMinor" BIGINT,
    "approvalCurrencyCode" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPermissionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Approval" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Loan" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "loanOfficerId" TEXT,
    "accountNumber" TEXT NOT NULL,
    "denominationCurrency" TEXT NOT NULL DEFAULT 'UGX',
    "principalMinor" BIGINT NOT NULL,
    "status" "public"."LoanStatus" NOT NULL DEFAULT 'APPROVED',
    "disbursedOn" DATE,
    "maturesOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LoanInstallment" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "installmentNumber" INTEGER NOT NULL,
    "dueOn" DATE NOT NULL,
    "principalDueMinor" BIGINT NOT NULL,
    "interestDueMinor" BIGINT NOT NULL,
    "feesDueMinor" BIGINT NOT NULL DEFAULT 0,
    "penaltiesDueMinor" BIGINT NOT NULL DEFAULT 0,
    "principalPaidMinor" BIGINT NOT NULL DEFAULT 0,
    "interestPaidMinor" BIGINT NOT NULL DEFAULT 0,
    "feesPaidMinor" BIGINT NOT NULL DEFAULT 0,
    "penaltiesPaidMinor" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LoanTransaction" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "transactionType" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "settlementCurrency" TEXT NOT NULL,
    "settlementAmountMinor" BIGINT NOT NULL,
    "denominationAmountMinor" BIGINT NOT NULL,
    "priceSnapshotId" UUID,
    "externalReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "reversedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SavingsAccount" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavingsAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SavingsTransaction" (
    "id" UUID NOT NULL,
    "savingsAccountId" UUID NOT NULL,
    "transactionType" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "externalReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavingsTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OwnershipPool" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."OwnershipType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnershipPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LedgerAccount" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."AccountType" NOT NULL,
    "currencyCode" VARCHAR(10) NOT NULL,
    "ownershipPoolId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Journal" (
    "id" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT,
    "narration" TEXT NOT NULL,
    "status" "public"."JournalStatus" NOT NULL DEFAULT 'PENDING',
    "reversalOfId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."JournalLine" (
    "id" UUID NOT NULL,
    "journalId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "direction" "public"."EntryDirection" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PriceSnapshot" (
    "id" UUID NOT NULL,
    "baseCode" VARCHAR(10) NOT NULL,
    "quoteCode" VARCHAR(10) NOT NULL,
    "price" DECIMAL(38,18) NOT NULL,
    "status" "public"."PriceStatus" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sourceQuotes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InvestorProfile" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "kycStatus" "public"."KycStatus" NOT NULL DEFAULT 'INCOMPLETE',
    "payoutAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InvestorOrganizationAccess" (
    "id" UUID NOT NULL,
    "investorId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "status" "public"."InvestorAccessStatus" NOT NULL DEFAULT 'REQUESTED',
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestorOrganizationAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InvestorInvite" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "public"."InvestorAccessStatus" NOT NULL DEFAULT 'INVITED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestorInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InvestorAccessRequest" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT,
    "status" "public"."InvestorAccessStatus" NOT NULL DEFAULT 'REQUESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestorAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InvestmentCommitment" (
    "id" UUID NOT NULL,
    "investorId" UUID NOT NULL,
    "accessId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "contributionCurrency" TEXT NOT NULL,
    "contributionAmountMinor" BIGINT NOT NULL,
    "amountSats" BIGINT NOT NULL,
    "priceSnapshotId" UUID NOT NULL,
    "status" "public"."InvestmentStatus" NOT NULL DEFAULT 'AWAITING_INVOICE',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fundedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestmentCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LightningInvoice" (
    "id" UUID NOT NULL,
    "commitmentId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerInvoiceId" TEXT NOT NULL,
    "bolt11" TEXT NOT NULL,
    "paymentHash" TEXT,
    "amountSats" BIGINT NOT NULL,
    "status" "public"."LightningInvoiceStatus" NOT NULL DEFAULT 'NEW',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LightningInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MigrationRun" (
    "id" UUID NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceTenant" TEXT NOT NULL,
    "organizationId" UUID,
    "status" "public"."MigrationRunStatus" NOT NULL DEFAULT 'CREATED',
    "manifestSha256" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MigrationArtifact" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MigrationCheckpoint" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "cursor" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MigrationIdMap" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "sovlendId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationIdMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SystemWallet" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "public"."WalletKind" NOT NULL,
    "network" "public"."WalletNetwork" NOT NULL,
    "publicAddress" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TransferProposal" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "destinationAddress" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "networkFeeMinor" BIGINT,
    "status" "public"."ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "threshold" INTEGER NOT NULL,
    "unsignedPayload" JSONB,
    "transactionHash" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TransferApproval" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "signerRef" TEXT NOT NULL,
    "signatureRef" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Document" (
    "id" UUID NOT NULL,
    "clientId" UUID,
    "loanId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "objectKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OutboxEvent" (
    "id" UUID NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InboxEvent" (
    "id" UUID NOT NULL,
    "handler" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditEvent" (
    "id" UUID NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "correlationId" UUID NOT NULL,
    "metadata" JSONB NOT NULL,
    "previousHash" TEXT,
    "eventHash" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" UUID NOT NULL,
    "audienceType" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channels" JSONB NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Reminder" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "installmentId" UUID NOT NULL,
    "notificationId" UUID,
    "type" "public"."ReminderType" NOT NULL,
    "status" "public"."ReminderStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Office_organizationId_parentId_idx" ON "public"."Office"("organizationId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Office_organizationId_name_key" ON "public"."Office"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "public"."user"("email");

-- CreateIndex
CREATE INDEX "user_organizationId_officeId_systemRole_idx" ON "public"."user"("organizationId", "officeId", "systemRole");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "public"."session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "public"."session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "public"."account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "public"."account"("issuer", "accountId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "public"."verification"("identifier");

-- CreateIndex
CREATE INDEX "passkey_userId_idx" ON "public"."passkey"("userId");

-- CreateIndex
CREATE INDEX "passkey_credentialID_idx" ON "public"."passkey"("credentialID");

-- CreateIndex
CREATE UNIQUE INDEX "Client_authUserId_key" ON "public"."Client"("authUserId");

-- CreateIndex
CREATE INDEX "Client_organizationId_officeId_status_idx" ON "public"."Client"("organizationId", "officeId", "status");

-- CreateIndex
CREATE INDEX "Client_organizationId_externalId_idx" ON "public"."Client"("organizationId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_organizationId_accountNumber_key" ON "public"."Client"("organizationId", "accountNumber");

-- CreateIndex
CREATE INDEX "LoanProduct_organizationId_active_idx" ON "public"."LoanProduct"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "LoanProduct_organizationId_shortName_version_key" ON "public"."LoanProduct"("organizationId", "shortName", "version");

-- CreateIndex
CREATE INDEX "LoanApplication_clientId_status_idx" ON "public"."LoanApplication"("clientId", "status");

-- CreateIndex
CREATE INDEX "LoanApplication_productId_status_idx" ON "public"."LoanApplication"("productId", "status");

-- CreateIndex
CREATE INDEX "LoanApplication_submittedById_status_idx" ON "public"."LoanApplication"("submittedById", "status");

-- CreateIndex
CREATE INDEX "PermissionGroup_organizationId_idx" ON "public"."PermissionGroup"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionGroup_organizationId_name_key" ON "public"."PermissionGroup"("organizationId", "name");

-- CreateIndex
CREATE INDEX "PermissionGroupPermission_permissionCode_idx" ON "public"."PermissionGroupPermission"("permissionCode");

-- CreateIndex
CREATE INDEX "UserPermissionAssignment_userId_validUntil_idx" ON "public"."UserPermissionAssignment"("userId", "validUntil");

-- CreateIndex
CREATE INDEX "UserPermissionAssignment_officeId_scope_idx" ON "public"."UserPermissionAssignment"("officeId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermissionAssignment_userId_groupId_scope_officeId_key" ON "public"."UserPermissionAssignment"("userId", "groupId", "scope", "officeId");

-- CreateIndex
CREATE INDEX "Approval_applicationId_decidedAt_idx" ON "public"."Approval"("applicationId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_applicationId_key" ON "public"."Loan"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_accountNumber_key" ON "public"."Loan"("accountNumber");

-- CreateIndex
CREATE INDEX "Loan_officeId_status_idx" ON "public"."Loan"("officeId", "status");

-- CreateIndex
CREATE INDEX "Loan_clientId_status_idx" ON "public"."Loan"("clientId", "status");

-- CreateIndex
CREATE INDEX "LoanInstallment_dueOn_idx" ON "public"."LoanInstallment"("dueOn");

-- CreateIndex
CREATE UNIQUE INDEX "LoanInstallment_loanId_installmentNumber_key" ON "public"."LoanInstallment"("loanId", "installmentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LoanTransaction_idempotencyKey_key" ON "public"."LoanTransaction"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "LoanTransaction_reversedById_key" ON "public"."LoanTransaction"("reversedById");

-- CreateIndex
CREATE INDEX "LoanTransaction_loanId_businessDate_idx" ON "public"."LoanTransaction"("loanId", "businessDate");

-- CreateIndex
CREATE INDEX "LoanTransaction_externalReference_idx" ON "public"."LoanTransaction"("externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "SavingsAccount_accountNumber_key" ON "public"."SavingsAccount"("accountNumber");

-- CreateIndex
CREATE INDEX "SavingsAccount_clientId_status_idx" ON "public"."SavingsAccount"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SavingsTransaction_idempotencyKey_key" ON "public"."SavingsTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SavingsTransaction_savingsAccountId_createdAt_idx" ON "public"."SavingsTransaction"("savingsAccountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OwnershipPool_organizationId_name_key" ON "public"."OwnershipPool"("organizationId", "name");

-- CreateIndex
CREATE INDEX "LedgerAccount_type_currencyCode_idx" ON "public"."LedgerAccount"("type", "currencyCode");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_code_currencyCode_ownershipPoolId_key" ON "public"."LedgerAccount"("code", "currencyCode", "ownershipPoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Journal_reversalOfId_key" ON "public"."Journal"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "Journal_idempotencyKey_key" ON "public"."Journal"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Journal_officeId_businessDate_status_idx" ON "public"."Journal"("officeId", "businessDate", "status");

-- CreateIndex
CREATE INDEX "Journal_referenceType_referenceId_idx" ON "public"."Journal"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "JournalLine_journalId_idx" ON "public"."JournalLine"("journalId");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_createdAt_idx" ON "public"."JournalLine"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "PriceSnapshot_baseCode_quoteCode_observedAt_idx" ON "public"."PriceSnapshot"("baseCode", "quoteCode", "observedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "InvestorProfile_userId_key" ON "public"."InvestorProfile"("userId");

-- CreateIndex
CREATE INDEX "InvestorOrganizationAccess_organizationId_status_idx" ON "public"."InvestorOrganizationAccess"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InvestorOrganizationAccess_investorId_organizationId_key" ON "public"."InvestorOrganizationAccess"("investorId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InvestorInvite_tokenHash_key" ON "public"."InvestorInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "InvestorInvite_email_status_idx" ON "public"."InvestorInvite"("email", "status");

-- CreateIndex
CREATE INDEX "InvestorInvite_organizationId_status_idx" ON "public"."InvestorInvite"("organizationId", "status");

-- CreateIndex
CREATE INDEX "InvestorAccessRequest_organizationId_status_createdAt_idx" ON "public"."InvestorAccessRequest"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "InvestorAccessRequest_email_idx" ON "public"."InvestorAccessRequest"("email");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentCommitment_idempotencyKey_key" ON "public"."InvestmentCommitment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "InvestmentCommitment_investorId_status_createdAt_idx" ON "public"."InvestmentCommitment"("investorId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "InvestmentCommitment_organizationId_status_idx" ON "public"."InvestmentCommitment"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LightningInvoice_commitmentId_key" ON "public"."LightningInvoice"("commitmentId");

-- CreateIndex
CREATE UNIQUE INDEX "LightningInvoice_providerInvoiceId_key" ON "public"."LightningInvoice"("providerInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "LightningInvoice_paymentHash_key" ON "public"."LightningInvoice"("paymentHash");

-- CreateIndex
CREATE INDEX "LightningInvoice_status_expiresAt_idx" ON "public"."LightningInvoice"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "MigrationRun_sourceSystem_sourceTenant_createdAt_idx" ON "public"."MigrationRun"("sourceSystem", "sourceTenant", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MigrationArtifact_runId_entityType_idx" ON "public"."MigrationArtifact"("runId", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationArtifact_runId_entityType_pageNumber_key" ON "public"."MigrationArtifact"("runId", "entityType", "pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationCheckpoint_runId_entityType_key" ON "public"."MigrationCheckpoint"("runId", "entityType");

-- CreateIndex
CREATE INDEX "MigrationIdMap_entityType_sovlendId_idx" ON "public"."MigrationIdMap"("entityType", "sovlendId");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationIdMap_runId_entityType_legacyId_key" ON "public"."MigrationIdMap"("runId", "entityType", "legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemWallet_network_publicAddress_key" ON "public"."SystemWallet"("network", "publicAddress");

-- CreateIndex
CREATE UNIQUE INDEX "TransferProposal_idempotencyKey_key" ON "public"."TransferProposal"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TransferProposal_walletId_status_idx" ON "public"."TransferProposal"("walletId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TransferApproval_proposalId_signerRef_key" ON "public"."TransferApproval"("proposalId", "signerRef");

-- CreateIndex
CREATE UNIQUE INDEX "Document_objectKey_key" ON "public"."Document"("objectKey");

-- CreateIndex
CREATE INDEX "Document_clientId_idx" ON "public"."Document"("clientId");

-- CreateIndex
CREATE INDEX "Document_loanId_idx" ON "public"."Document"("loanId");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_occurredAt_idx" ON "public"."OutboxEvent"("publishedAt", "occurredAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_aggregateType_aggregateId_idx" ON "public"."OutboxEvent"("aggregateType", "aggregateId");

-- CreateIndex
CREATE UNIQUE INDEX "InboxEvent_id_handler_key" ON "public"."InboxEvent"("id", "handler");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_occurredAt_idx" ON "public"."AuditEvent"("entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_correlationId_idx" ON "public"."AuditEvent"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_deduplicationKey_key" ON "public"."Notification"("deduplicationKey");

-- CreateIndex
CREATE INDEX "Notification_audienceType_audienceId_readAt_createdAt_idx" ON "public"."Notification"("audienceType", "audienceId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_deduplicationKey_key" ON "public"."Reminder"("deduplicationKey");

-- CreateIndex
CREATE INDEX "Reminder_status_scheduledFor_idx" ON "public"."Reminder"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "Reminder_loanId_type_idx" ON "public"."Reminder"("loanId", "type");

-- AddForeignKey
ALTER TABLE "public"."Office" ADD CONSTRAINT "Office_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Office" ADD CONSTRAINT "Office_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."Office"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user" ADD CONSTRAINT "user_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user" ADD CONSTRAINT "user_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "public"."Office"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."passkey" ADD CONSTRAINT "passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Client" ADD CONSTRAINT "Client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Client" ADD CONSTRAINT "Client_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "public"."Office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Client" ADD CONSTRAINT "Client_assignedOfficerId_fkey" FOREIGN KEY ("assignedOfficerId") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Client" ADD CONSTRAINT "Client_authUserId_fkey" FOREIGN KEY ("authUserId") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanProduct" ADD CONSTRAINT "LoanProduct_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanApplication" ADD CONSTRAINT "LoanApplication_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanApplication" ADD CONSTRAINT "LoanApplication_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."LoanProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanApplication" ADD CONSTRAINT "LoanApplication_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PermissionGroup" ADD CONSTRAINT "PermissionGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PermissionGroupPermission" ADD CONSTRAINT "PermissionGroupPermission_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."PermissionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PermissionGroupPermission" ADD CONSTRAINT "PermissionGroupPermission_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "public"."PermissionDefinition"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserPermissionAssignment" ADD CONSTRAINT "UserPermissionAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserPermissionAssignment" ADD CONSTRAINT "UserPermissionAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."PermissionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserPermissionAssignment" ADD CONSTRAINT "UserPermissionAssignment_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "public"."Office"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Approval" ADD CONSTRAINT "Approval_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "public"."LoanApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Approval" ADD CONSTRAINT "Approval_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Loan" ADD CONSTRAINT "Loan_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "public"."LoanApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Loan" ADD CONSTRAINT "Loan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Loan" ADD CONSTRAINT "Loan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."LoanProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Loan" ADD CONSTRAINT "Loan_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "public"."Office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Loan" ADD CONSTRAINT "Loan_loanOfficerId_fkey" FOREIGN KEY ("loanOfficerId") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanInstallment" ADD CONSTRAINT "LoanInstallment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "public"."Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanTransaction" ADD CONSTRAINT "LoanTransaction_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "public"."Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanTransaction" ADD CONSTRAINT "LoanTransaction_priceSnapshotId_fkey" FOREIGN KEY ("priceSnapshotId") REFERENCES "public"."PriceSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanTransaction" ADD CONSTRAINT "LoanTransaction_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "public"."LoanTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SavingsAccount" ADD CONSTRAINT "SavingsAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SavingsTransaction" ADD CONSTRAINT "SavingsTransaction_savingsAccountId_fkey" FOREIGN KEY ("savingsAccountId") REFERENCES "public"."SavingsAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OwnershipPool" ADD CONSTRAINT "OwnershipPool_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LedgerAccount" ADD CONSTRAINT "LedgerAccount_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "public"."Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LedgerAccount" ADD CONSTRAINT "LedgerAccount_ownershipPoolId_fkey" FOREIGN KEY ("ownershipPoolId") REFERENCES "public"."OwnershipPool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Journal" ADD CONSTRAINT "Journal_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "public"."Office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Journal" ADD CONSTRAINT "Journal_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "public"."Journal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."JournalLine" ADD CONSTRAINT "JournalLine_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "public"."Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_baseCode_fkey" FOREIGN KEY ("baseCode") REFERENCES "public"."Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_quoteCode_fkey" FOREIGN KEY ("quoteCode") REFERENCES "public"."Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InvestorProfile" ADD CONSTRAINT "InvestorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InvestorOrganizationAccess" ADD CONSTRAINT "InvestorOrganizationAccess_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "public"."InvestorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InvestorOrganizationAccess" ADD CONSTRAINT "InvestorOrganizationAccess_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InvestorInvite" ADD CONSTRAINT "InvestorInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InvestorAccessRequest" ADD CONSTRAINT "InvestorAccessRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InvestmentCommitment" ADD CONSTRAINT "InvestmentCommitment_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "public"."InvestorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InvestmentCommitment" ADD CONSTRAINT "InvestmentCommitment_accessId_fkey" FOREIGN KEY ("accessId") REFERENCES "public"."InvestorOrganizationAccess"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InvestmentCommitment" ADD CONSTRAINT "InvestmentCommitment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InvestmentCommitment" ADD CONSTRAINT "InvestmentCommitment_priceSnapshotId_fkey" FOREIGN KEY ("priceSnapshotId") REFERENCES "public"."PriceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LightningInvoice" ADD CONSTRAINT "LightningInvoice_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "public"."InvestmentCommitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MigrationArtifact" ADD CONSTRAINT "MigrationArtifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."MigrationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MigrationCheckpoint" ADD CONSTRAINT "MigrationCheckpoint_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."MigrationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MigrationIdMap" ADD CONSTRAINT "MigrationIdMap_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."MigrationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TransferProposal" ADD CONSTRAINT "TransferProposal_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "public"."SystemWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TransferApproval" ADD CONSTRAINT "TransferApproval_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "public"."TransferProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Document" ADD CONSTRAINT "Document_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Document" ADD CONSTRAINT "Document_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "public"."Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Reminder" ADD CONSTRAINT "Reminder_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "public"."Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Reminder" ADD CONSTRAINT "Reminder_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "public"."LoanInstallment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Reminder" ADD CONSTRAINT "Reminder_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "public"."Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
