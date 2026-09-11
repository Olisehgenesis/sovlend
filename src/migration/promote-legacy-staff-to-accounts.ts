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
 * Order-independent name key used to catch a legacy Fineract staff record that is actually the
 * same person as an already-existing real (non-legacy) account -- e.g. "Nakirijja Kivumbi,
 * Teopista" (legacy `displayName`) vs. "Teopista Nakirijja Kivumbi" (a manually onboarded staff
 * account). Sorting the tokens makes comma/word-order differences irrelevant.
 */
function normalizeNameForMatch(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
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
 *
 * Guard against duplicate identities: a legacy Fineract staff record can describe the same real
 * person as an account that was already onboarded manually (different id, different email domain,
 * created outside this migration). Promoting it anyway would create a second working login with
 * its own password, splitting that person's assignments across two accounts (this happened once in
 * production -- see the "Nakirijja Kivumbi, Teopista" incident). Any legacy staff whose name
 * matches an existing non-legacy user is skipped so a human can decide how to merge it instead.
 */
export async function promoteLegacyStaffToAccounts(prismaClient: PrismaClient): Promise<PromoteLegacyStaffResult> {
  const legacyStaff = await prismaClient.user.findMany({
    where: { email: { startsWith: LEGACY_STAFF_EMAIL_PREFIX, endsWith: LEGACY_STAFF_EMAIL_SUFFIX } },
    select: { id: true, name: true, email: true, systemRole: true, officeId: true, organizationId: true },
    orderBy: { name: "asc" },
  });

  const otherUsers = await prismaClient.user.findMany({
    where: {
      NOT: { email: { startsWith: LEGACY_STAFF_EMAIL_PREFIX, endsWith: LEGACY_STAFF_EMAIL_SUFFIX } },
    },
    select: { id: true, name: true, email: true },
  });
  const existingByNameKey = new Map<string, { id: string; email: string }[]>();
  for (const other of otherUsers) {
    const key = normalizeNameForMatch(other.name);
    if (!key) continue;
    const bucket = existingByNameKey.get(key);
    if (bucket) bucket.push({ id: other.id, email: other.email });
    else existingByNameKey.set(key, [{ id: other.id, email: other.email }]);
  }

  const promoted: { userId: string; name: string; email: string }[] = [];
  const skipped: { userId: string; name: string; reason: string }[] = [];

  for (const staff of legacyStaff) {
    try {
      const possibleDuplicates = existingByNameKey.get(normalizeNameForMatch(staff.name));
      if (possibleDuplicates && possibleDuplicates.length > 0) {
        const matches = possibleDuplicates.map((match) => `${match.email} (${match.id})`).join(", ");
        throw new Error(`Matches existing non-legacy account(s) by name -- possible duplicate, resolve manually: ${matches}`);
      }

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
            // Loan Officers only ever work their own assigned portfolio (loans/clients/groups/
            // savings accounts), never their whole office -- see loanScopeWhere/clientScopeWhere/
            // etc. in data-scope.ts, which key off this "OWN" scope.
            const ownScope = staff.systemRole === "LOAN_OFFICER";
            await prismaClient.userPermissionAssignment.create({
              data: {
                userId: staff.id,
                groupId: group.id,
                scope: organizationScope ? "ORGANIZATION" : ownScope ? "OWN" : "OFFICE",
                officeId: organizationScope || ownScope ? null : staff.officeId,
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
