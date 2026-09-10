import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";
import { loadProvisioningReport } from "@/modules/reports/domain/risk-report";

import { assertBalancedJournal } from "../domain/journal";
import { assertPeriodOpen } from "./assert-period-open";

export type PostProvisioningEntryCommand = Readonly<{
  organizationId: string;
  officeId: string;
  actorUserId: string;
  asOfDate: Date;
  narration?: string;
}>;

export type PostProvisioningEntryResult = Readonly<{
  posting: {
    id: string;
    requiredProvisionMinor: bigint;
    previousProvisionMinor: bigint;
    deltaMinor: bigint;
    journalId: string | null;
  };
  alreadyPosted: boolean;
}>;

/**
 * Provisioning Entries (item 6, iLend "Provisioning Entries"): posts a journal recognizing the
 * change in required loan-loss provision for an office, computed from the same PAR-aging ladder
 * as reports/risk/provisioning (see loadProvisioningReport) -- Normal/Watch/Substandard/Doubtful/
 * Loss at 1%/5%/25%/50%/100% of outstanding exposure. Unlike a report, this posts a real balanced
 * journal: only the *change* since the last posting for this office (deltaMinor) is posted, so
 * running this repeatedly never double-counts the provision balance -- a growing requirement
 * debits provisionExpenseAccountId / credits loanLossProvisionAccountId, a shrinking one (an
 * improving portfolio) posts the reverse (a provision release/writeback). One ProvisioningPosting
 * row is kept per office+asOfDate (idempotent re-runs for the same date return the original
 * result without posting again), and its previousProvisionMinor comes from the most recent prior
 * posting for that office.
 */
export async function postProvisioningEntry(
  prisma: PrismaClient,
  command: PostProvisioningEntryCommand,
): Promise<PostProvisioningEntryResult> {
  const asOfDate = toUtcDay(command.asOfDate);

  await new AuthorizationService(prisma).assertAllowed({
    actorUserId: command.actorUserId,
    permission: permissions.ledgerPost,
    organizationId: command.organizationId,
    officeId: command.officeId,
  });

  const office = await prisma.office.findFirst({ where: { id: command.officeId, organizationId: command.organizationId } });
  if (!office) throw new Error("Office not found for this organization");

  const existing = await prisma.provisioningPosting.findUnique({
    where: { officeId_asOfDate: { officeId: command.officeId, asOfDate } },
  });
  if (existing) {
    return {
      posting: {
        id: existing.id,
        requiredProvisionMinor: existing.requiredProvisionMinor,
        previousProvisionMinor: existing.previousProvisionMinor,
        deltaMinor: existing.deltaMinor,
        journalId: existing.journalId,
      },
      alreadyPosted: true,
    };
  }

  const defaults = await prisma.provisioningAccountingDefaults.findUnique({ where: { organizationId: command.organizationId } });
  if (!defaults?.provisionExpenseAccountId || !defaults.loanLossProvisionAccountId) {
    throw new Error("Provisioning expense and loan loss provision accounts are not configured");
  }
  const provisionExpenseAccountId = defaults.provisionExpenseAccountId;
  const loanLossProvisionAccountId = defaults.loanLossProvisionAccountId;

  const report = await loadProvisioningReport(
    prisma,
    { organizationId: command.organizationId, officeIds: null, officerUserId: null },
    { officeId: command.officeId },
    asOfDate,
  );
  const requiredProvisionMinor = report.totals.totalProvisionMinor;

  const priorPosting = await prisma.provisioningPosting.findFirst({
    where: { officeId: command.officeId, asOfDate: { lt: asOfDate } },
    orderBy: { asOfDate: "desc" },
  });
  const previousProvisionMinor = priorPosting?.requiredProvisionMinor ?? 0n;
  const deltaMinor = requiredProvisionMinor - previousProvisionMinor;

  await assertPeriodOpen(prisma, { officeId: command.officeId, businessDate: asOfDate });

  const narration = command.narration?.trim() || `Provisioning entry ${office.name} as of ${asOfDate.toISOString().slice(0, 10)}`;

  const result = await prisma.$transaction(async (transaction) => {
    if (deltaMinor === 0n) {
      const posting = await transaction.provisioningPosting.create({
        data: {
          organizationId: command.organizationId,
          officeId: command.officeId,
          asOfDate,
          requiredProvisionMinor,
          previousProvisionMinor,
          deltaMinor,
          journalId: null,
          createdByUserId: command.actorUserId,
        },
      });
      return { posting, journal: null };
    }

    const increasing = deltaMinor > 0n;
    const amountMinor = increasing ? deltaMinor : -deltaMinor;
    const journalLines = increasing
      ? [
          { accountId: provisionExpenseAccountId, direction: "DEBIT" as const, amountMinor, memo: "Provision expense" },
          { accountId: loanLossProvisionAccountId, direction: "CREDIT" as const, amountMinor, memo: "Loan loss provision" },
        ]
      : [
          { accountId: loanLossProvisionAccountId, direction: "DEBIT" as const, amountMinor, memo: "Loan loss provision release" },
          { accountId: provisionExpenseAccountId, direction: "CREDIT" as const, amountMinor, memo: "Provision expense release" },
        ];
    assertBalancedJournal(journalLines.map((line) => ({ ...line, currencyCode: "UGX" })));

    const journal = await transaction.journal.create({
      data: {
        officeId: command.officeId,
        businessDate: asOfDate,
        referenceType: "LOAN_LOSS_PROVISION",
        referenceId: command.officeId,
        narration,
        idempotencyKey: `provisioning-entry:${command.officeId}:${asOfDate.toISOString().slice(0, 10)}`,
      },
    });
    await transaction.journalLine.createMany({
      data: journalLines.map((line) => ({ journalId: journal.id, ...line })),
    });
    await transaction.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });

    const posting = await transaction.provisioningPosting.create({
      data: {
        organizationId: command.organizationId,
        officeId: command.officeId,
        asOfDate,
        requiredProvisionMinor,
        previousProvisionMinor,
        deltaMinor,
        journalId: journal.id,
        createdByUserId: command.actorUserId,
      },
    });

    const correlationId = randomUUID();
    const metadata = {
      officeId: command.officeId,
      asOfDate: asOfDate.toISOString().slice(0, 10),
      requiredProvisionMinor: requiredProvisionMinor.toString(),
      previousProvisionMinor: previousProvisionMinor.toString(),
      deltaMinor: deltaMinor.toString(),
      journalId: journal.id,
    };
    const action = "ledger.provisioning_entry_posted";
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action, metadata })).digest("hex");
    await transaction.auditEvent.create({
      data: {
        actorId: command.actorUserId,
        action,
        entityType: "Journal",
        entityId: journal.id,
        correlationId,
        metadata,
        eventHash,
      },
    });
    await transaction.outboxEvent.create({
      data: { aggregateType: "Journal", aggregateId: journal.id, eventType: action, payload: metadata },
    });

    return { posting, journal };
  });

  return {
    posting: {
      id: result.posting.id,
      requiredProvisionMinor: result.posting.requiredProvisionMinor,
      previousProvisionMinor: result.posting.previousProvisionMinor,
      deltaMinor: result.posting.deltaMinor,
      journalId: result.posting.journalId,
    },
    alreadyPosted: false,
  };
}

function toUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
