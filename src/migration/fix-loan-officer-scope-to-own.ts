import { prisma } from "@/lib/prisma";

/**
 * One-off, idempotent data fix for Loan Officers promoted before the "OWN" scope was wired
 * into `promote-legacy-staff-to-accounts.ts`. Those users were assigned `scope: "OFFICE"`,
 * which meant they saw their whole office's loans/clients/groups/savings instead of only the
 * records assigned to them personally (`loanOfficerId`/`assignedOfficerId`/`staffId`/
 * `fieldOfficerId`). This narrows their existing `UserPermissionAssignment` rows to
 * `scope: "OWN"` (with `officeId` cleared), matching what a fresh promotion would produce
 * today. Safe to re-run: only touches LOAN_OFFICER users still on `scope: "OFFICE"`.
 */
async function main() {
  const assignments = await prisma.userPermissionAssignment.findMany({
    where: { scope: "OFFICE", user: { systemRole: "LOAN_OFFICER" } },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  if (assignments.length === 0) {
    console.log("No Loan Officer assignments still on OFFICE scope. Nothing to do.");
    return;
  }

  for (const assignment of assignments) {
    await prisma.userPermissionAssignment.update({
      where: { id: assignment.id },
      data: { scope: "OWN", officeId: null },
    });
    console.log(`Updated ${assignment.user.name} (${assignment.user.email ?? assignment.user.id}) to OWN scope.`);
  }

  console.log(`Done. Updated ${assignments.length} Loan Officer assignment(s) from OFFICE to OWN scope.`);
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
