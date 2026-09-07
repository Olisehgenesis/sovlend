import type { PrismaClient } from "@prisma/client";

import { ReadOnlyFineractClient } from "./fineract-client";
import { importLegacyClient } from "./import-client";
import { importLegacyLoansForClient } from "./import-loans";
import { importAllLegacyGroups } from "./import-groups";

export type ImportAllCommand = Readonly<{
  organizationId: string;
  defaultOfficeId: string;
  actorUserId: string;
  includeLoans: boolean;
  /** Also import groups (SACCO-style collective savings/borrowing groups) and their member roster. */
  includeGroups?: boolean;
}>;

/** Bulk-imports every legacy client (with family/identities/notes/documents) and, optionally, their loan history. Resumable: already-imported clients and loans are skipped. */
export async function importAllLegacyData(prisma: PrismaClient, fineract: ReadOnlyFineractClient, command: ImportAllCommand) {
  const offices = await prisma.office.findMany({ where: { organizationId: command.organizationId }, select: { id: true, name: true } });
  const officeIdByName = new Map(offices.map((office) => [office.name.trim().toLowerCase(), office.id]));

  let clientsImported = 0;
  let clientsSkipped = 0;
  let loansImported = 0;
  const errors: string[] = [];

  let offset = 0;
  const pageSize = 200;
  for (;;) {
    const page = (await fineract.getPage("clients", offset, pageSize)) as { totalFilteredRecords: number; pageItems: Array<Record<string, unknown>> };
    if (!page.pageItems || page.pageItems.length === 0) break;

    for (const legacyClient of page.pageItems) {
      const legacyClientId = Number(legacyClient.id);
      const officeName = String(legacyClient.officeName ?? "").trim().toLowerCase();
      const officeId = officeIdByName.get(officeName) ?? command.defaultOfficeId;

      try {
        const result = await importLegacyClient(prisma, fineract, { legacyClientId, organizationId: command.organizationId, officeId, actorUserId: command.actorUserId });
        if (result.alreadyImported) { clientsSkipped += 1; continue; }
        clientsImported += 1;

        if (command.includeLoans) {
          const loanResult = await importLegacyLoansForClient(prisma, fineract, { legacyClientId, clientId: result.clientId, organizationId: command.organizationId, officeId, actorUserId: command.actorUserId });
          loansImported += loanResult.loansImported;
          errors.push(...loanResult.loansSkipped.map((message) => `Client #${legacyClientId}: ${message}`));
        }
      } catch (error) {
        errors.push(`Client #${legacyClientId}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }

    offset += page.pageItems.length;
    if (offset >= page.totalFilteredRecords) break;
  }

  let groupsImported = 0;
  let groupsSkipped = 0;
  if (command.includeGroups) {
    const groupResult = await importAllLegacyGroups(prisma, fineract, { organizationId: command.organizationId, defaultOfficeId: command.defaultOfficeId, actorUserId: command.actorUserId, includeLoans: command.includeLoans });
    groupsImported = groupResult.groupsImported;
    groupsSkipped = groupResult.groupsSkipped;
    loansImported += groupResult.loansImported;
    errors.push(...groupResult.errors);
  }

  return { clientsImported, clientsSkipped, loansImported, groupsImported, groupsSkipped, errors };
}

export { ReadOnlyFineractClient };

