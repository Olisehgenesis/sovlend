import type { PrismaClient } from "@prisma/client";

import { hasPermission, type PermissionCode, type PermissionContext } from "../domain/permissions";

export class PermissionDeniedError extends Error {}

export class AuthorizationService {
  constructor(private readonly prisma: PrismaClient) {}

  async assertAllowed(context: Omit<PermissionContext, "officeAncestorIds">): Promise<void> {
    const [assignments, officeAncestorIds] = await Promise.all([
      this.prisma.userPermissionAssignment.findMany({
        where: { userId: context.actorUserId },
        include: { group: { include: { permissions: true } } },
      }),
      context.officeId ? this.getOfficeAncestors(context.officeId) : Promise.resolve([]),
    ]);

    const allowed = hasPermission(
      assignments.map((assignment) => ({
        permissionCodes: assignment.group.permissions.map((item) => item.permissionCode),
        organizationId: assignment.group.organizationId,
        scope: assignment.scope,
        officeId: assignment.officeId,
        includeChildOffices: assignment.includeChildOffices,
        approvalLimitMinor: assignment.approvalLimitMinor,
        approvalCurrencyCode: assignment.approvalCurrencyCode,
        validFrom: assignment.validFrom,
        validUntil: assignment.validUntil,
      })),
      { ...context, officeAncestorIds },
    );

    if (!allowed) throw new PermissionDeniedError(`Permission denied: ${context.permission}`);
  }

  private async getOfficeAncestors(officeId: string): Promise<string[]> {
    const ancestors: string[] = [];
    let currentId: string | null = officeId;
    while (currentId) {
      const office: { parentId: string | null } | null = await this.prisma.office.findUnique({ where: { id: currentId }, select: { parentId: true } });
      currentId = office?.parentId ?? null;
      if (currentId) ancestors.push(currentId);
    }
    return ancestors;
  }
}

export function permissionCode(value: PermissionCode) {
  return value;
}