import type { UserRole } from "@prisma/client";

/** Branch/general managers and admins may originate, approve, disburse, and activate savings themselves. */
export function canBypassOriginationMakerChecker(systemRole: UserRole | null | undefined) {
  return systemRole === "BRANCH_MANAGER" || systemRole === "GENERAL_MANAGER" || systemRole === "ADMIN";
}

export function canSelfApproveLoanApplication(systemRole: UserRole | null | undefined) {
  return canBypassOriginationMakerChecker(systemRole);
}

// Managers already carry full override authority. Tellers hand out cash at the counter, so they
// may also disburse a loan they did not need a second person for. Loan officers stay bound.
export function canDisburseWithoutMakerCheckerSplit(systemRole: UserRole | null | undefined) {
  return canBypassOriginationMakerChecker(systemRole) || systemRole === "TELLER";
}


export function canEditSubmittedLoanApplication({
  actorUserId,
  actorSystemRole,
  submittedById,
}: {
  actorUserId: string;
  actorSystemRole: UserRole | null | undefined;
  submittedById: string | null;
}) {
  // Pending applications are still drafts in business terms: let the submitter fix mistakes, and
  // also let managers/admins who already hold self-approval authority make the same corrections.
  // Everyone else stays bound by the maker-checker split and cannot alter another user's submission.
  return submittedById === actorUserId || canSelfApproveLoanApplication(actorSystemRole);
}
