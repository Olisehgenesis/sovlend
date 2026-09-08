import type { UserRole } from "@prisma/client";

export function canSelfApproveLoanApplication(systemRole: UserRole | null | undefined) {
  return systemRole === "BRANCH_MANAGER" || systemRole === "GENERAL_MANAGER" || systemRole === "ADMIN";
}

// Branch managers/admins already carry full override authority (see canSelfApproveLoanApplication),
// and tellers are the staff who physically hand out cash at disbursement time in real branch
// operations, so they're exempted from the application maker-checker split too. Loan officers -
// the actual "makers" of most applications - remain bound by it.
export function canDisburseWithoutMakerCheckerSplit(systemRole: UserRole | null | undefined) {
  return (
    systemRole === "BRANCH_MANAGER" ||
    systemRole === "GENERAL_MANAGER" ||
    systemRole === "ADMIN" ||
    systemRole === "TELLER"
  );
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
