import { createHash, randomUUID } from "node:crypto";

import { prisma as defaultPrisma } from "@/lib/prisma";
import { storeDocumentBytes } from "@/lib/document-storage";

import type { ReadOnlyFineractClient } from "./fineract-client";

type PrismaLike = typeof defaultPrisma;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateFromParts(value: unknown): Date | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [year, month, day] = value as number[];
  return new Date(Date.UTC(year, month - 1, day));
}

/** Best-effort field lookup across Fineract's inconsistent camelCase/lowercase naming. */
function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined) return record[key];
  return undefined;
}

export type ImportLegacyClientCommand = Readonly<{
  legacyClientId: number;
  organizationId: string;
  officeId: string;
  actorUserId: string;
}>;

export async function importLegacyClient(prisma: PrismaLike, fineract: ReadOnlyFineractClient, command: ImportLegacyClientCommand) {
  const legacyExternalId = `legacy:${command.legacyClientId}`;
  const existing = await prisma.client.findFirst({ where: { organizationId: command.organizationId, externalId: legacyExternalId } });
  if (existing) return { clientId: existing.id, accountNumber: existing.accountNumber, familyMembersImported: 0, identifiersImported: 0, notesImported: 0, documentsImported: 0, alreadyImported: true as const };

  const legacyClient = (await fineract.getClient(command.legacyClientId)) as Record<string, unknown>;
  const [familyMembers, identifiers, notes, documents] = await Promise.all([
    fineract.getClientSubResource(command.legacyClientId, "familymembers") as Promise<unknown[]>,
    fineract.getClientSubResource(command.legacyClientId, "identifiers") as Promise<unknown[]>,
    fineract.getClientSubResource(command.legacyClientId, "notes") as Promise<unknown[]>,
    fineract.getClientSubResource(command.legacyClientId, "documents") as Promise<unknown[]>,
  ]);

  const gender = legacyClient.gender as Record<string, unknown> | undefined;
  const clientType = legacyClient.clientType as Record<string, unknown> | undefined;
  const classification = legacyClient.clientClassification as Record<string, unknown> | undefined;
  const timeline = (legacyClient.timeline ?? {}) as Record<string, unknown>;

  const id = randomUUID();
  const today = new Date();
  const datePrefix = `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}`;
  const correlationId = randomUUID();

  const client = await prisma.$transaction(async (transaction) => {
    const [organization] = await transaction.$queryRaw<{ nextClientSequence: number }[]>`UPDATE "Organization" SET "nextClientSequence" = "nextClientSequence" + 1 WHERE id = ${command.organizationId}::uuid RETURNING "nextClientSequence"`;
    const accountNumber = `${datePrefix}-${String(organization.nextClientSequence).padStart(6, "0")}`;
    const metadata = { officeId: command.officeId, accountNumber, legacyClientId: command.legacyClientId };
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: "client.imported", metadata })).digest("hex");

    const created = await transaction.client.create({
      data: {
        id,
        organizationId: command.organizationId,
        officeId: command.officeId,
        accountNumber,
        externalId: str(legacyClient.externalId) ?? `legacy:${command.legacyClientId}`,
        firstName: str(legacyClient.firstname) ?? "Unknown",
        middleName: str(legacyClient.middlename),
        lastName: str(legacyClient.lastname) ?? "Unknown",
        mobileNumber: str(legacyClient.mobileNo),
        dateOfBirth: dateFromParts(legacyClient.dateOfBirth),
        genderCode: str(gender?.name),
        clientTypeCode: str(clientType?.name),
        classificationCode: str(classification?.name),
        isStaff: legacyClient.isStaff === true,
        status: legacyClient.active === true ? "ACTIVE" : "SUBMITTED",
        submittedOn: dateFromParts(timeline.submittedOnDate) ?? today,
        activatedOn: dateFromParts(legacyClient.activationDate),
      },
    });

    for (const raw of familyMembers) {
      const member = raw as Record<string, unknown>;
      await transaction.clientFamilyMember.create({
        data: {
          clientId: created.id,
          firstName: str(pick(member, "firstName", "firstname")) ?? "Unknown",
          middleName: str(pick(member, "middleName", "middlename")),
          lastName: str(pick(member, "lastName", "lastname")) ?? "Unknown",
          qualification: str(member.qualification),
          mobileNumber: str(pick(member, "mobileNumber", "mobileNo")),
          age: num(member.age),
          isDependent: pick(member, "isDependent") === true,
          relationship: str((pick(member, "relationship") as Record<string, unknown> | undefined)?.name),
          genderCode: str((pick(member, "gender") as Record<string, unknown> | undefined)?.name),
          profession: str((pick(member, "profession") as Record<string, unknown> | undefined)?.name),
          maritalStatus: str((pick(member, "maritalStatus") as Record<string, unknown> | undefined)?.name),
          dateOfBirth: dateFromParts(pick(member, "dateOfBirth")),
        },
      });
    }

    for (const raw of identifiers) {
      const identifier = raw as Record<string, unknown>;
      const documentType = str((identifier.documentType as Record<string, unknown> | undefined)?.name) ?? "Unknown";
      const uniqueNumber = str(pick(identifier, "documentKey", "uniqueNumber"));
      if (!uniqueNumber) continue;
      await transaction.clientIdentifier.create({ data: { clientId: created.id, documentType, status: identifier.status === false ? "INACTIVE" : "ACTIVE", uniqueNumber, description: str(identifier.description) } });
    }

    for (const raw of notes) {
      const note = raw as Record<string, unknown>;
      const body = str(note.note);
      if (!body) continue;
      await transaction.clientNote.create({ data: { clientId: created.id, authorId: command.actorUserId, body } });
    }

    await transaction.clientNote.create({ data: { clientId: created.id, authorId: command.actorUserId, body: `Imported from legacy iLend client #${command.legacyClientId} on ${today.toISOString().slice(0, 10)}.` } });
    await transaction.auditEvent.create({ data: { actorId: command.actorUserId, action: "client.imported", entityType: "Client", entityId: created.id, correlationId, metadata, eventHash } });
    await transaction.outboxEvent.create({ data: { aggregateType: "Client", aggregateId: created.id, eventType: "client.imported", payload: metadata } });
    return created;
  });

  let documentsImported = 0;
  for (const raw of documents) {
    const document = raw as Record<string, unknown>;
    const documentId = num(document.id);
    if (documentId === null) continue;
    try {
      const { bytes, contentType } = await fineract.downloadClientDocument(command.legacyClientId, documentId);
      const sha256 = await storeDocumentBytes(bytes);
      await prisma.document.create({ data: { clientId: client.id, name: str(document.name) ?? str(document.fileName) ?? `Document ${documentId}`, description: str(document.description), objectKey: sha256, sha256, mediaType: str(document.type) ?? contentType } });
      documentsImported += 1;
    } catch {
      // Skip documents that fail to download rather than aborting the whole import.
    }
  }

  return { clientId: client.id, accountNumber: client.accountNumber, familyMembersImported: familyMembers.length, identifiersImported: identifiers.length, notesImported: notes.length, documentsImported, alreadyImported: false as const };
}
