import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { seedPermissionGroups } from "@/modules/identity/application/seed-permissions";
import {
  STANDING_ORDER_LIABILITY_ACCOUNT_CODE,
  STANDING_ORDER_PERMISSION_GROUP_NAME,
  STANDING_ORDER_SETTLEMENT_ACCOUNT_NAME,
  STANDING_ORDER_SETTLEMENT_ACCOUNT_TYPE,
  STANDING_ORDER_SYSTEM_EMAIL,
} from "@/modules/lending/domain/standing-order-sweep-constants";

/**
 * One-off, idempotent provisioning for the standing-order sweep feature. For every
 * organization, this ensures:
 *   1. The "Standing Order Automation" permission group exists (least-privilege: only
 *      LOAN_REPAYMENT_RECORD + SAVINGS_TRANSACT), via the same seedPermissionGroups() every
 *      other permission group is seeded through.
 *   2. A single non-interactive "system" User exists (systemRole SYSTEM, banned: true so it can
 *      never sign in) and is assigned to that group at ORGANIZATION scope, so the sweep worker
 *      can call postRepayment() as a real, authorized actor.
 *   3. A dedicated SettlementAccount ("Client Savings Sweep") exists, pointed at the same
 *      savings-liability GL account the historical savings ledger backfill uses, so a sweep's
 *      journal entry correctly debits the client's savings liability instead of an external
 *      cash/bank account.
 *
 * Safe to re-run: every write is an upsert. Run this once per environment (including production,
 * via the `migrate` compose service or a one-off `docker compose run --rm worker` command)
 * before enabling the standing-order sweep schedule.
 */
async function main() {
  const organizations = await prisma.organization.findMany({ select: { id: true, name: true } });
  if (organizations.length === 0) {
    console.log("No organizations found. Nothing to provision.");
    return;
  }

  const liabilityAccount = await prisma.ledgerAccount.findFirst({ where: { code: STANDING_ORDER_LIABILITY_ACCOUNT_CODE } });
  if (!liabilityAccount) {
    throw new Error(`Chart-of-accounts is missing the savings-liability GL code ${STANDING_ORDER_LIABILITY_ACCOUNT_CODE} required for the sweep settlement account.`);
  }

  for (const organization of organizations) {
    await seedPermissionGroups(prisma, organization.id);
    const group = await prisma.permissionGroup.findUnique({
      where: { organizationId_name: { organizationId: organization.id, name: STANDING_ORDER_PERMISSION_GROUP_NAME } },
    });
    if (!group) throw new Error(`Failed to seed the "${STANDING_ORDER_PERMISSION_GROUP_NAME}" permission group for ${organization.name}.`);

    const systemUser = await prisma.user.upsert({
      where: { email: STANDING_ORDER_SYSTEM_EMAIL },
      create: {
        id: randomUUID(),
        email: STANDING_ORDER_SYSTEM_EMAIL,
        name: "Standing Order Automation",
        emailVerified: true,
        banned: true,
        banReason: "Non-interactive service identity; never used for sign-in.",
        organizationId: organization.id,
        systemRole: "SYSTEM",
      },
      update: { banned: true, systemRole: "SYSTEM" },
    });

    const existingAssignment = await prisma.userPermissionAssignment.findFirst({
      where: { userId: systemUser.id, groupId: group.id, scope: "ORGANIZATION", officeId: null },
    });
    if (!existingAssignment) {
      await prisma.userPermissionAssignment.create({
        data: { userId: systemUser.id, groupId: group.id, scope: "ORGANIZATION", officeId: null, includeChildOffices: false },
      });
    }

    const existingSettlement = await prisma.settlementAccount.findFirst({
      where: { organizationId: organization.id, name: STANDING_ORDER_SETTLEMENT_ACCOUNT_NAME },
    });
    if (!existingSettlement) {
      await prisma.settlementAccount.create({
        data: {
          organizationId: organization.id,
          name: STANDING_ORDER_SETTLEMENT_ACCOUNT_NAME,
          type: STANDING_ORDER_SETTLEMENT_ACCOUNT_TYPE,
          currencyCode: "UGX",
          ledgerAccountId: liabilityAccount.id,
          active: true,
        },
      });
    }

    console.log(`Provisioned standing-order automation for ${organization.name} (system user ${systemUser.id}).`);
  }

  console.log("Done.");
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
