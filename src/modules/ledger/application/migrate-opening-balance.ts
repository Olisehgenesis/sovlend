import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";

import { assertBalancedJournal } from "../domain/journal";
import { assertPeriodOpen } from "./assert-period-open";

export type MigrateOpeningBalanceCommand = Readonly<{
  organizationId: string;
  officeId: string;
  actorUserId: string;
  ledgerAccountId: string;
  asOfDate: Date;
  direction: "DEBIT" | "CREDIT";
  amountMinor: bigint;
  narration?: string;
}>;

export type MigrateOpeningBalanceResult = Readonly<{
  migration: {
    id: string;
    ledgerAccountId: string;
    officeId: string;
    asOfDate: Date;
    direction: "DEBIT" | "CREDIT";
    amountMinor: bigint;
    journalId: string;
  };
  alreadyMigrated: boolean;
}>;

/**
 * Migrate Opening Balances (item 7, iLend "Migrate Opening Balances (Office-wise)"): sets the
 * starting balance of a GL account at a specific office as of a date. Posts a single balanced
 * journal (referenceType "OPENING_BALANCE") for the entered amount/direction against the org's
 * configured Opening Balance Equity contra account (OpeningBalanceAccountingDefaults), and
 * records one OpeningBalanceMigration row per office+account so the same account can only be
 * migrated once per office -- re-attempting returns the original result rather than posting a
 * duplicate/conflicting balance. To correct a mistaken migration, post an ordinary manual/
 * frequent-posting adjustment; this function intentionally does not support amendment so the
 * "opening balance" concept stays meaningful (a one-time starting point, not a running total).
 */
export async function migrateOpeningBalance(
  prisma: PrismaClient,
  command: MigrateOpeningBalanceCommand,
): Promise<MigrateOpeningBalanceResult> {
  if (command.amountMinor <= 0n) throw new Error("Opening balance amount must be positive");

  const asOfDate = toUtcDay(command.asOfDate);

  await new AuthorizationService(prisma).assertAllowed({
    actorUserId: command.actorUserId,
    permission: permissions.ledgerPost,
    organizationId: command.organizationId,
    officeId: command.officeId,
  });

  const office = await prisma.office.findFirst({ where: { id: command.officeId, organizationId: command.organizationId } });
  if (!office) throw new Error("Office not found for this organization");

  const ledgerAccount = await prisma.ledgerAccount.findFirst({
    where: { id: command.ledgerAccountId, active: true, usage: "DETAIL" },
  });
  if (!ledgerAccount) throw new Error("GL account not found or is not an active detail account");

  const existing = await prisma.openingBalanceMigration.findUnique({
    where: { officeId_ledgerAccountId: { officeId: command.officeId, ledgerAccountId: command.ledgerAccountId } },
  });
  if (existing) {
    return {
      migration: {
        id: existing.id,
        ledgerAccountId: existing.ledgerAccountId,
        officeId: existing.officeId,
        asOfDate: existing.asOfDate,
        direction: existing.direction,
        amountMinor: existing.amountMinor,
        journalId: existing.journalId,
      },
      alreadyMigrated: true,
    };
  }

  const defaults = await prisma.openingBalanceAccountingDefaults.findUnique({ where: { organizationId: command.organizationId } });
  if (!defaults?.openingBalanceEquityAccountId) {
    throw new Error("Opening balance equity account is not configured");
  }
  const equityAccountId = defaults.openingBalanceEquityAccountId;
  if (equityAccountId === command.ledgerAccountId) {
    throw new Error("The opening balance equity account cannot be migrated against itself");
  }

  await assertPeriodOpen(prisma, { officeId: command.officeId, businessDate: asOfDate });

  const narration =
    command.narration?.trim() || `Opening balance migration for ${ledgerAccount.name} at ${office.name} as of ${asOfDate.toISOString().slice(0, 10)}`;
  const contraDirection = command.direction === "DEBIT" ? ("CREDIT" as const) : ("DEBIT" as const);
  const journalLines = [
    { accountId: command.ledgerAccountId, direction: command.direction, amountMinor: command.amountMinor, memo: "Opening balance" },
    { accountId: equityAccountId, direction: contraDirection, amountMinor: command.amountMinor, memo: "Opening balance equity" },
  ];
  assertBalancedJournal(journalLines.map((line) => ({ ...line, currencyCode: "UGX" })));

  const result = await prisma.$transaction(async (transaction) => {
    const journal = await transaction.journal.create({
      data: {
        officeId: command.officeId,
        businessDate: asOfDate,
        referenceType: "OPENING_BALANCE",
        referenceId: command.ledgerAccountId,
        narration,
        idempotencyKey: `opening-balance:${command.officeId}:${command.ledgerAccountId}`,
      },
    });
    await transaction.journalLine.createMany({
      data: journalLines.map((line) => ({ journalId: journal.id, ...line })),
    });
    await transaction.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });

    const migration = await transaction.openingBalanceMigration.create({
      data: {
        organizationId: command.organizationId,
        officeId: command.officeId,
        ledgerAccountId: command.ledgerAccountId,
        asOfDate,
        direction: command.direction,
        amountMinor: command.amountMinor,
        journalId: journal.id,
        createdByUserId: command.actorUserId,
      },
    });

    const correlationId = randomUUID();
    const metadata = {
      officeId: command.officeId,
      ledgerAccountId: command.ledgerAccountId,
      asOfDate: asOfDate.toISOString().slice(0, 10),
      direction: command.direction,
      amountMinor: command.amountMinor.toString(),
      journalId: journal.id,
    };
    const action = "ledger.opening_balance_migrated";
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

    return migration;
  });

  return {
    migration: {
      id: result.id,
      ledgerAccountId: result.ledgerAccountId,
      officeId: result.officeId,
      asOfDate: result.asOfDate,
      direction: result.direction,
      amountMinor: result.amountMinor,
      journalId: result.journalId,
    },
    alreadyMigrated: false,
  };
}

function toUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
