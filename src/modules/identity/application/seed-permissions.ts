import type { PrismaClient } from "@prisma/client";

import { defaultPermissionGroups, permissions } from "../domain/permissions";

const descriptions: Record<string, string> = {
  [permissions.clientView]: "View clients in the assigned scope",
  [permissions.clientManage]: "Create and update client records",
  [permissions.loanView]: "View loans and schedules",
  [permissions.loanApply]: "Create and submit loan applications",
  [permissions.loanApprove]: "Approve loans within the assigned amount limit",
  [permissions.loanDisburse]: "Disburse approved loans",
  [permissions.loanRepayment]: "Record loan repayments",
  [permissions.loanClose]: "Close fully settled loans",
  [permissions.loanWriteOff]: "Write off loans through controlled approval",
  [permissions.loanReverse]: "Reverse eligible loan transactions",
  [permissions.savingsView]: "View savings accounts",
  [permissions.savingsTransact]: "Record savings transactions",
  [permissions.treasuryView]: "View treasury and investor positions",
  [permissions.treasuryPropose]: "Propose treasury movements",
  [permissions.treasuryApprove]: "Approve treasury movements as a separate signer",
  [permissions.ledgerView]: "View accounting journals and balances",
  [permissions.ledgerPost]: "Post controlled accounting journals",
  [permissions.reportView]: "View operational and financial reports",
  [permissions.userManage]: "Manage user identities",
  [permissions.permissionManage]: "Manage permission groups and assignments",
  [permissions.auditView]: "View immutable audit records",
};

export async function seedPermissionGroups(prisma: PrismaClient, organizationId: string) {
  for (const code of Object.values(permissions)) {
    await prisma.permissionDefinition.upsert({
      where: { code },
      create: { code, description: descriptions[code], riskLevel: riskLevel(code) },
      update: { description: descriptions[code], riskLevel: riskLevel(code) },
    });
  }

  for (const [name, permissionCodes] of Object.entries(defaultPermissionGroups)) {
    const group = await prisma.permissionGroup.upsert({
      where: { organizationId_name: { organizationId, name } },
      create: { organizationId, name, system: true },
      update: { system: true },
    });
    for (const permissionCode of permissionCodes) {
      await prisma.permissionGroupPermission.upsert({
        where: { groupId_permissionCode: { groupId: group.id, permissionCode } },
        create: { groupId: group.id, permissionCode },
        update: {},
      });
    }
  }
}

function riskLevel(code: string) {
  if (code.includes("APPROVE") || code.includes("DISBURSE") || code.includes("WRITE_OFF") || code.includes("REVERSE") || code.includes("POST")) return "HIGH";
  if (code.includes("MANAGE") || code.includes("TRANSACT") || code.includes("CREATE") || code.includes("CLOSE")) return "MEDIUM";
  return "LOW";
}