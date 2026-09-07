import { createHash, randomUUID } from "node:crypto";

import { prisma as defaultPrisma } from "@/lib/prisma";

import type { ReadOnlyFineractClient } from "./fineract-client";
import { importLegacyLoansForGroup } from "./import-loans";

type PrismaLike = typeof defaultPrisma;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateFromParts(value: unknown): Date | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [year, month, day] = value as number[];
  return new Date(Date.UTC(year, month - 1, day));
}

export type ImportLegacyGroupCommand = Readonly<{
  legacyGroupId: number;
  organizationId: string;
  officeId: string;
  actorUserId: string;
  /** Also pull the group's own loan accounts (SACCO-style "GROUP LOAN" products). */
  includeLoans?: boolean;
}>;

export type ImportLegacyGroupResult = Readonly<{
  groupId: string;
  accountNumber: string;
  membersLinked: number;
  membersSkipped: number;
  loansImported: number;
  alreadyImported: boolean;
}>;

/**
 * Imports a legacy group (a SACCO-style collective savings/borrowing group — not a joint
 * individual account) plus its client-membership roster. Groups are matched by
 * `externalId = "legacy:<id>"`, mirroring `importLegacyClient`'s convention, so re-runs are
 * resumable and idempotent. Client members must already have been imported (via
 * `importLegacyClient`) before the group is imported, otherwise their membership link is skipped
 * and reported rather than aborting the whole group.
 */
export async function importLegacyGroup(prisma: PrismaLike, fineract: ReadOnlyFineractClient, command: ImportLegacyGroupCommand): Promise<ImportLegacyGroupResult> {
  const legacyExternalId = `legacy:${command.legacyGroupId}`;
  const existing = await prisma.group.findFirst({ where: { organizationId: command.organizationId, externalId: legacyExternalId } });
  if (existing) {
    const loansImported = command.includeLoans
      ? (await importLegacyLoansForGroup(prisma, fineract, { legacyGroupId: command.legacyGroupId, groupId: existing.id, organizationId: command.organizationId, officeId: existing.officeId, actorUserId: command.actorUserId })).loansImported
      : 0;
    return { groupId: existing.id, accountNumber: existing.accountNumber, membersLinked: 0, membersSkipped: 0, loansImported, alreadyImported: true };
  }

  const legacyGroup = (await fineract.getGroup(command.legacyGroupId)) as Record<string, unknown>;
  const timeline = (legacyGroup.timeline ?? {}) as Record<string, unknown>;
  const clientMembers = (legacyGroup.clientMembers as Array<Record<string, unknown>> | undefined) ?? [];

  const id = randomUUID();
  const correlationId = randomUUID();
  const metadata = { officeId: command.officeId, legacyGroupId: command.legacyGroupId };
  const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: "group.imported", metadata })).digest("hex");

  const group = await prisma.$transaction(async (transaction) => {
    const created = await transaction.group.create({
      data: {
        id,
        organizationId: command.organizationId,
        officeId: command.officeId,
        accountNumber: str(legacyGroup.accountNo) ?? `LEGACY-GRP-${command.legacyGroupId}`,
        externalId: legacyExternalId,
        name: str(legacyGroup.name) ?? `Legacy group ${command.legacyGroupId}`,
        status: legacyGroup.active === true ? "ACTIVE" : "PENDING",
        submittedOn: dateFromParts(timeline.submittedOnDate),
        activatedOn: dateFromParts(timeline.activatedOnDate),
      },
    });
    await transaction.groupNote.create({ data: { groupId: created.id, authorId: command.actorUserId, body: `Imported from legacy iLend group #${command.legacyGroupId} on ${new Date().toISOString().slice(0, 10)}.` } });
    await transaction.auditEvent.create({ data: { actorId: command.actorUserId, action: "group.imported", entityType: "Group", entityId: created.id, correlationId, metadata, eventHash } });
    await transaction.outboxEvent.create({ data: { aggregateType: "Group", aggregateId: created.id, eventType: "group.imported", payload: metadata } });
    return created;
  });

  let membersLinked = 0;
  let membersSkipped = 0;
  for (const member of clientMembers) {
    const legacyClientId = Number(member.id);
    if (!Number.isFinite(legacyClientId)) { membersSkipped += 1; continue; }
    const client = await prisma.client.findFirst({ where: { organizationId: command.organizationId, externalId: `legacy:${legacyClientId}` } });
    if (!client) { membersSkipped += 1; continue; }
    await prisma.groupMember.upsert({
      where: { groupId_clientId: { groupId: group.id, clientId: client.id } },
      create: { groupId: group.id, clientId: client.id },
      update: {},
    });
    membersLinked += 1;
  }

  const loansImported = command.includeLoans
    ? (await importLegacyLoansForGroup(prisma, fineract, { legacyGroupId: command.legacyGroupId, groupId: group.id, organizationId: command.organizationId, officeId: command.officeId, actorUserId: command.actorUserId })).loansImported
    : 0;

  return { groupId: group.id, accountNumber: group.accountNumber, membersLinked, membersSkipped, loansImported, alreadyImported: false };
}

export type ImportAllGroupsCommand = Readonly<{
  organizationId: string;
  defaultOfficeId: string;
  actorUserId: string;
  includeLoans: boolean;
}>;

/** Bulk-imports every legacy group (with client-member roster and, optionally, group-owned loans). Resumable: already-imported groups are skipped. */
export async function importAllLegacyGroups(prisma: PrismaLike, fineract: ReadOnlyFineractClient, command: ImportAllGroupsCommand) {
  const offices = await prisma.office.findMany({ where: { organizationId: command.organizationId }, select: { id: true, name: true } });
  const officeIdByName = new Map(offices.map((office) => [office.name.trim().toLowerCase(), office.id]));

  let groupsImported = 0;
  let groupsSkipped = 0;
  let loansImported = 0;
  const errors: string[] = [];

  let offset = 0;
  const pageSize = 200;
  for (;;) {
    const page = (await fineract.getPage("groups", offset, pageSize)) as { totalFilteredRecords: number; pageItems: Array<Record<string, unknown>> };
    if (!page.pageItems || page.pageItems.length === 0) break;

    for (const legacyGroup of page.pageItems) {
      const legacyGroupId = Number(legacyGroup.id);
      const officeName = String(legacyGroup.officeName ?? "").trim().toLowerCase();
      const officeId = officeIdByName.get(officeName) ?? command.defaultOfficeId;

      try {
        const result = await importLegacyGroup(prisma, fineract, { legacyGroupId, organizationId: command.organizationId, officeId, actorUserId: command.actorUserId, includeLoans: command.includeLoans });
        if (result.alreadyImported) { groupsSkipped += 1; } else { groupsImported += 1; }
        loansImported += result.loansImported;
      } catch (error) {
        errors.push(`Group #${legacyGroupId}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }

    offset += page.pageItems.length;
    if (offset >= page.totalFilteredRecords) break;
  }

  return { groupsImported, groupsSkipped, loansImported, errors };
}
