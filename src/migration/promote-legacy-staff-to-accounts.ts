import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import type { PrismaClient, UserRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const LEGACY_STAFF_EMAIL_PREFIX = "legacy-staff-";
const LEGACY_STAFF_EMAIL_SUFFIX = "@jumpstart.import.internal";
const DEFAULT_TEMP_PASSWORD = "Jumpstart@2026";
const REAL_EMAIL_DOMAIN = "sovlend.space";
const CREDENTIAL_ISSUER = "local:credential";
const CREDENTIAL_PROVIDER_ID = "credential";

const groupForRole: Partial<Record<UserRole, string>> = {
  ADMIN: "General Manager",
  GENERAL_MANAGER: "General Manager",
  BRANCH_MANAGER: "Branch Manager",
  TELLER: "Teller",
  LOAN_OFFICER: "Loan Officer",
  INVESTOR: "Investor",
  TREASURY_SIGNER: "Treasury Signer",
  AUDITOR: "Auditor",
};

function slugify(part: string) {
  return part
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Legacy staff names were imported verbatim from Fineract's `displayName` field, which is
 * consistently formatted as "Lastname(s), Firstname". Split on the comma to build a
 * firstname.lastname@sovlend.space address; fall back to splitting on whitespace for the rare
 * name with no comma.
 */
function deriveNameParts(displayName: string): { firstName: string; lastName: string } {
  const commaIndex = displayName.indexOf(",");
  if (commaIndex >= 0) {
    const lastName = displayName.slice(0, commaIndex).trim();
    const firstName = displayName.slice(commaIndex + 1).trim();
    return { firstName: firstName || lastName, lastName: lastName || firstName };
  }
  const tokens = displayName.trim().split(/\s+/);
  if (tokens.length === 1) return { firstName: tokens[0], lastName: tokens[0] };
  return { firstName: tokens[tokens.length - 1], lastName: tokens.slice(0, -1).join(" ") };
}

async function buildUniqueEmail(prismaClient: PrismaClient, firstName: string, lastName: string, excludeUserId: string) {
  const firstSlug = slugify(firstName) || "staff";
  const lastSlug = slugify(lastName) || "member";
  const base = `${firstSlug}.${lastSlug}`;

  for (let suffix = 0; suffix < 50; suffix += 1) {
    const candidate = `${base}${suffix === 0 ? "" : suffix}@${REAL_EMAIL_DOMAIN}`;
    const existing = await prismaClient.user.findUnique({ where: { email: candidate }, select: { id: true } });
    if (!existing || existing.id === excludeUserId) return candidate;
  }
  throw new Error(`Could not derive a unique email for ${firstName} ${lastName}`);
}

export type PromoteLegacyStaffResult = Readonly<{
  promoted: readonly { userId: string; name: string; email: string }[];
  skipped: readonly { userId: string; name: string; reason: string }[];
}>;

/**
 * One-time, idempotent migration that turns the attribution-only legacy staff `User` rows
 * (created by `backfill-officer-assignments.ts` with synthetic `legacy-staff-{id}@...import.internal`
 * emails and no login credentials) into real, working staff logins -- in place, so every existing
 * FK reference (`assignedLoans`, `assignedSavingsAccounts`, `assignedClients`, `assignedGroups`,
 * notes, etc.) keeps pointing at the same user id and needs no migration of its own.
 *
 * Each promoted account gets a firstname.lastname@sovlend.space email and the shared temporary
 * password, with `mustChangePassword` set so the app forces a real password on first sign-in.
 * Safe to re-run: users whose email is no longer the synthetic placeholder are skipped.
 */
export async function promoteLegacyStaffToAccounts(prismaClient: PrismaClient): Promise<PromoteLegacyStaffResult> {
  const legacyStaff = await prismaClient.user.findMany({
    where: { email: { startsWith: LEGACY_STAFF_EMAIL_PREFIX, endsWith: LEGACY_STAFF_EMAIL_SUFFIX } },
    select: { id: true, name: true, email: true, systemRole: true, officeId: true, organizationId: true },
    orderBy: { name: "asc" },
  });

  const promoted: { userId: string; name: string; email: string }[] = [];
  const skipped: { userId: string; name: string; reason: string }[] = [];

  for (const staff of legacyStaff) {
    try {
      const { firstName, lastName } = deriveNameParts(staff.name);
      const email = await buildUniqueEmail(prismaClient, firstName, lastName, staff.id);

      await prismaClient.user.update({
        where: { id: staff.id },
        data: { email, role: staff.systemRole === "ADMIN" ? "admin" : "user", mustChangePassword: true },
      });

      // Set the credential login password directly (equivalent to what better-auth's
      // `auth.api.setUserPassword` admin endpoint does internally) since that endpoint requires an
      // authenticated admin session, which a background migration script does not have.
      const passwordHash = await hashPassword(DEFAULT_TEMP_PASSWORD);
      await prismaClient.account.upsert({
        where: { issuer_accountId: { issuer: CREDENTIAL_ISSUER, accountId: staff.id } },
        create: { id: randomUUID(), issuer: CREDENTIAL_ISSUER, providerId: CREDENTIAL_PROVIDER_ID, accountId: staff.id, userId: staff.id, password: passwordHash },
        update: { password: passwordHash },
      });

      const groupName = groupForRole[staff.systemRole];
      if (groupName && staff.organizationId) {
        const existingAssignment = await prismaClient.userPermissionAssignment.findFirst({ where: { userId: staff.id } });
        if (!existingAssignment) {
          const group = await prismaClient.permissionGroup.findUnique({
            where: { organizationId_name: { organizationId: staff.organizationId, name: groupName } },
          });
          if (group) {
            const organizationScope = ["ADMIN", "GENERAL_MANAGER", "TREASURY_SIGNER", "AUDITOR", "INVESTOR"].includes(staff.systemRole);
            await prismaClient.userPermissionAssignment.create({
              data: {
                userId: staff.id,
                groupId: group.id,
                scope: organizationScope ? "ORGANIZATION" : "OFFICE",
                officeId: organizationScope ? null : staff.officeId,
                includeChildOffices: staff.systemRole === "BRANCH_MANAGER",
              },
            });
          }
        }
      }

      promoted.push({ userId: staff.id, name: staff.name, email });
    } catch (error) {
      skipped.push({ userId: staff.id, name: staff.name, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { promoted, skipped };
}

async function main() {
  try {
    const result = await promoteLegacyStaffToAccounts(prisma);
    console.log(`Promoted ${result.promoted.length} legacy staff account(s) to real logins.`);
    for (const entry of result.promoted) console.log(`  ${entry.name} -> ${entry.email}`);
    if (result.skipped.length > 0) {
      console.log(`Skipped ${result.skipped.length} account(s):`);
      for (const entry of result.skipped) console.log(`  ${entry.name}: ${entry.reason}`);
    }
    console.log(`\nAll promoted accounts share the temporary password "${DEFAULT_TEMP_PASSWORD}" and must change it on first sign-in.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
