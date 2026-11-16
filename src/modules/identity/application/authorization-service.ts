import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  loadOfficeAncestorIds,
  loadPermissionAssignments,
} from "@/modules/identity/application/actor-access";
import { hasPermission, type PermissionCode, type PermissionContext } from "../domain/permissions";

export class PermissionDeniedError extends Error {}

export class AuthorizationService {
  constructor(private readonly prisma: PrismaClient) {}

  async assertAllowed(context: Omit<PermissionContext, "officeAncestorIds">): Promise<void> {
    const allowed = await this.isAllowed(context);
    if (!allowed) throw new PermissionDeniedError(`Permission denied: ${context.permission}`);
  }

  async isAllowed(context: Omit<PermissionContext, "officeAncestorIds">): Promise<boolean> {
    const [assignments, ancestorIds] = await Promise.all([
      this.loadAssignments(context.actorUserId),
      context.officeId ? this.getOfficeAncestors(context.officeId) : Promise.resolve([]),
    ]);

    return hasPermission(
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
      { ...context, officeAncestorIds: ancestorIds },
    );
  }

  // For organization-wide resources with no office dimension (e.g. products): any active
  // assignment granting the permission counts, regardless of the assignment's office scope.
  async isAllowedForOrganization(actorUserId: string, organizationId: string, permission: PermissionCode): Promise<boolean> {
    const now = new Date();
    const assignments = await this.loadAssignments(actorUserId);
    return assignments.some((assignment) => {
      if (assignment.group.organizationId !== organizationId) return false;
      if (assignment.validFrom > now || (assignment.validUntil && assignment.validUntil <= now)) return false;
      return assignment.group.permissions.some((item) => item.permissionCode === permission);
    });
  }

  private loadAssignments(userId: string) {
    if (this.prisma === prisma) return loadPermissionAssignments(userId);
    return this.prisma.userPermissionAssignment.findMany({
      where: { userId },
      include: { group: { include: { permissions: true } } },
    });
  }

  private async getOfficeAncestors(officeId: string): Promise<string[]> {
    if (this.prisma === prisma) return loadOfficeAncestorIds(officeId);

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