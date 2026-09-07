import type { PermissionDefinition, UserRole } from "@prisma/client";

import { permissions, reportPermissionGroups } from "../domain/permissions";

type PermissionDefinitionLike = Pick<PermissionDefinition, "code" | "description" | "riskLevel">;
type PermissionBlueprintCategory = Readonly<{ id: string; label: string; sections: readonly Readonly<{ id: string; label: string; codes: readonly string[]; }>[]; }>;

export type PermissionCatalogSection = Readonly<{
  id: string;
  label: string;
  permissions: readonly PermissionDefinitionLike[];
}>;

export type PermissionCatalogCategory = Readonly<{
  id: string;
  label: string;
  sections: readonly PermissionCatalogSection[];
}>;

const permissionBlueprint: readonly PermissionBlueprintCategory[] = [
  {
    id: "clients",
    label: "Clients",
    sections: [{ id: "clients-core", label: "Client records", codes: [permissions.clientView, permissions.clientManage] }],
  },
  {
    id: "loans",
    label: "Loans",
    sections: [{ id: "loans-core", label: "Loan lifecycle", codes: [permissions.loanView, permissions.loanApply, permissions.loanApprove, permissions.loanDisburse, permissions.loanRepayment, permissions.loanClose, permissions.loanWriteOff, permissions.loanReverse] }],
  },
  {
    id: "savings",
    label: "Savings",
    sections: [{ id: "savings-core", label: "Savings operations", codes: [permissions.savingsView, permissions.savingsTransact, permissions.savingsApprove] }],
  },
  {
    id: "treasury",
    label: "Treasury",
    sections: [{ id: "treasury-core", label: "Treasury controls", codes: [permissions.treasuryView, permissions.treasuryPropose, permissions.treasuryApprove] }],
  },
  {
    id: "accounting",
    label: "Accounting",
    sections: [{ id: "accounting-core", label: "Ledger controls", codes: [permissions.ledgerView, permissions.ledgerPost] }],
  },
  {
    id: "reports",
    label: "Reports",
    sections: [
      { id: "reports-general", label: "General access", codes: [permissions.reportView] },
      { id: "reports-accounting", label: "Accounting", codes: [...reportPermissionGroups.accounting] },
      { id: "reports-risk", label: "Risk", codes: [...reportPermissionGroups.risk] },
      { id: "reports-operations", label: "Operations", codes: [...reportPermissionGroups.operations] },
      { id: "reports-insights", label: "Insights", codes: [...reportPermissionGroups.insights] },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    sections: [{ id: "administration-core", label: "Identity and configuration", codes: [permissions.userManage, permissions.permissionManage, permissions.auditView, permissions.productManage] }],
  },
] as const;

const organizationManagedRoles = new Set<UserRole | "ADMIN" | "GENERAL_MANAGER" | "TREASURY_SIGNER" | "AUDITOR" | "INVESTOR">([
  "ADMIN",
  "GENERAL_MANAGER",
  "TREASURY_SIGNER",
  "AUDITOR",
  "INVESTOR",
]);

export function buildPermissionCategories(definitions: readonly PermissionDefinitionLike[]): PermissionCatalogCategory[] {
  const definitionByCode = new Map(definitions.map((definition) => [definition.code, definition]));
  const consumed = new Set<string>();

  const categories = permissionBlueprint
    .map((category) => ({
      id: category.id,
      label: category.label,
      sections: category.sections
        .map((section) => ({
          id: section.id,
          label: section.label,
          permissions: section.codes.flatMap((code) => {
            const definition = definitionByCode.get(code);
            if (!definition) return [];
            consumed.add(code);
            return [definition];
          }),
        }))
        .filter((section) => section.permissions.length > 0),
    }))
    .filter((category) => category.sections.length > 0);

  const uncategorized = definitions.filter((definition) => !consumed.has(definition.code)).sort((left, right) => left.code.localeCompare(right.code));
  if (uncategorized.length > 0) {
    categories.push({
      id: "other",
      label: "Other",
      sections: [{ id: "other-core", label: "Additional permissions", permissions: uncategorized }],
    });
  }

  return categories;
}

export function managedAssignmentDefaults(systemRole: UserRole, officeId: string | null) {
  if (organizationManagedRoles.has(systemRole)) {
    return { scope: "ORGANIZATION" as const, officeId: null, includeChildOffices: false };
  }
  if (!officeId) {
    throw new Error(`An office is required for ${systemRole}`);
  }
  return {
    scope: "OFFICE" as const,
    officeId,
    includeChildOffices: systemRole === "BRANCH_MANAGER",
  };
}
