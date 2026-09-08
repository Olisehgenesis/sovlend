import type { UserRole } from "@prisma/client";

/**
 * System roles that represent actual operational staff -- eligible to be assigned as a client's
 * or loan's field officer. Deliberately excludes CLIENT, INVESTOR, TREASURY_SIGNER, AUDITOR and
 * SYSTEM: those users may exist in the same office/organization but are never who you'd pick from
 * an "assign staff" or "loan officer" dropdown.
 */
export const STAFF_SYSTEM_ROLES: readonly UserRole[] = ["ADMIN", "GENERAL_MANAGER", "BRANCH_MANAGER", "TELLER", "LOAN_OFFICER"];
