"use client";

import type { PermissionCatalogCategory } from "@/modules/identity/application/team-permissions";
import { Building2, LoaderCircle, ShieldCheck, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type PermissionGroupSummary = {
  id: string;
  name: string;
  description: string | null;
  system: boolean;
  permissionCodes: string[];
};

type ActiveAssignment = {
  id: string;
  groupId: string;
  groupName: string;
  systemGroup: boolean;
  scope: string;
  officeName: string | null;
  includeChildOffices: boolean;
};

type UserSummary = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  systemRole: string;
  officeName: string | null;
  activeAssignments: ActiveAssignment[];
};

function toneForRisk(riskLevel: string) {
  if (riskLevel === "HIGH") return "in-arrears";
  if (riskLevel === "MEDIUM") return "review";
  return "up-to-date";
}

function summarizeAssignments(assignments: ActiveAssignment[]) {
  if (assignments.length === 0) return "No active permission group";
  return assignments
    .map((assignment) => {
      const officeScope = assignment.scope === "OFFICE" && assignment.officeName
        ? `${assignment.groupName} · ${assignment.officeName}${assignment.includeChildOffices ? " + children" : ""}`
        : `${assignment.groupName} · ${assignment.scope.toLowerCase()}`;
      return officeScope;
    })
    .join(", ");
}

export function TeamPermissionsPanel({
  categories,
  groups: initialGroups,
  organizationName,
  permissionCount,
  users: initialUsers,
}: {
  categories: PermissionCatalogCategory[];
  groups: PermissionGroupSummary[];
  organizationName: string;
  permissionCount: number;
  users: UserSummary[];
}) {
  const [groups, setGroups] = useState(initialGroups);
  const [users, setUsers] = useState(initialUsers);
  const [pendingPermissions, setPendingPermissions] = useState<string[]>([]);
  const [pendingUsers, setPendingUsers] = useState<string[]>([]);

  const membershipCounts = useMemo(() => {
    const counts = new Map<string, number>();
    users.forEach((user) => {
      user.activeAssignments.forEach((assignment) => {
        counts.set(assignment.groupId, (counts.get(assignment.groupId) ?? 0) + 1);
      });
    });
    return counts;
  }, [users]);

  async function togglePermission(groupId: string, permissionCode: string, enabled: boolean) {
    const key = `${groupId}:${permissionCode}`;
    setPendingPermissions((current) => [...current, key]);

    const response = await fetch(`/api/settings/permission-groups/${groupId}/permissions`, {
      method: enabled ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissionCode }),
    });
    const result = await response.json().catch(() => null);

    setPendingPermissions((current) => current.filter((item) => item !== key));
    if (!response.ok) {
      toast.error(result?.error ?? "Permission update failed");
      return;
    }

    setGroups((current) => current.map((group) => {
      if (group.id !== groupId) return group;
      const nextCodes = enabled
        ? [...new Set([...group.permissionCodes, permissionCode])].sort()
        : group.permissionCodes.filter((code) => code !== permissionCode);
      return { ...group, permissionCodes: nextCodes };
    }));
    toast.success(enabled ? "Permission granted to group" : "Permission removed from group");
  }

  async function assignGroup(userId: string, groupId: string) {
    if (!groupId) return;
    setPendingUsers((current) => [...current, userId]);

    const response = await fetch(`/api/settings/permission-groups/${groupId}/assign-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const result = await response.json().catch(() => null);

    setPendingUsers((current) => current.filter((item) => item !== userId));
    if (!response.ok) {
      toast.error(result?.error ?? "User assignment failed");
      return;
    }

    setUsers((current) => current.map((user) => user.id === userId ? {
      ...user,
      activeAssignments: [result.assignment],
    } : user));
    toast.success("Permission group updated");
  }

  return (
    <main className="admin-page team-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Team &amp; permissions</h1>
          <p>Manage built-in role groups, adjust report access, and keep {organizationName} staff in the right permission set.</p>
        </div>
      </section>

      <section className="team-summary-strip">
        <article>
          <ShieldCheck size={18} />
          <span>Permission groups</span>
          <strong>{groups.length}</strong>
          <small>Built-in and custom roles for this organization</small>
        </article>
        <article>
          <Building2 size={18} />
          <span>Permission codes</span>
          <strong>{permissionCount}</strong>
          <small>Includes all 21 report-specific permissions</small>
        </article>
        <article>
          <UsersRound size={18} />
          <span>Assigned users</span>
          <strong>{users.filter((user) => user.activeAssignments.length > 0).length}</strong>
          <small>{users.length} user account{users.length === 1 ? "" : "s"} in this organization</small>
        </article>
      </section>

      <section className="panel team-groups-panel">
        <div className="panel-heading">
          <div>
            <h2>Permission groups</h2>
            <p>System groups stay protected from deletion. Permission toggles remain editable so admins can tailor seeded roles without recreating them.</p>
          </div>
          <ShieldCheck size={19} />
        </div>
        <div className="team-groups-list">
          {groups.map((group) => (
            <article className="team-group-card" key={group.id}>
              <div className="team-group-header">
                <div>
                  <h3>{group.name}</h3>
                  <p>{membershipCounts.get(group.id) ?? 0} assigned user{(membershipCounts.get(group.id) ?? 0) === 1 ? "" : "s"} · {group.permissionCodes.length} permission{group.permissionCodes.length === 1 ? "" : "s"}</p>
                </div>
                {group.system ? <span className="status up-to-date">System group</span> : <span className="status review">Custom group</span>}
              </div>
              {group.description ? <p className="team-group-description">{group.description}</p> : null}

              <div className="team-category-list">
                {categories.map((category) => (
                  <details className="team-category" key={`${group.id}-${category.id}`} open={category.id === "reports" || category.id === "loans"}>
                    <summary>
                      <span>
                        <strong>{category.label}</strong>
                        <small>{category.sections.reduce((total, section) => total + section.permissions.length, 0)} permissions</small>
                      </span>
                    </summary>
                    <div className="team-category-body">
                      {category.sections.map((section) => (
                        <div className="team-permission-section" key={section.id}>
                          <h4>{section.label}</h4>
                          <div className="team-permission-list">
                            {section.permissions.map((permission) => {
                              const checked = group.permissionCodes.includes(permission.code);
                              const pending = pendingPermissions.includes(`${group.id}:${permission.code}`);
                              return (
                                <label className={`team-permission-row${checked ? " selected" : ""}${pending ? " pending" : ""}`} key={`${group.id}-${permission.code}`}>
                                  <span className="team-permission-copy">
                                    <strong>{permission.description}</strong>
                                    <small className="mono">{permission.code}</small>
                                  </span>
                                  <span className="team-permission-actions">
                                    <span className={`status ${toneForRisk(permission.riskLevel)}`}>{permission.riskLevel.toLowerCase()}</span>
                                    {pending ? <LoaderCircle className="spin" size={15} /> : null}
                                    <input
                                      checked={checked}
                                      disabled={pending}
                                      onChange={(event) => togglePermission(group.id, permission.code, event.target.checked)}
                                      type="checkbox"
                                    />
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel team-users-panel">
        <div className="panel-heading">
          <div>
            <h2>Team membership</h2>
            <p>Changing a group keeps the user in the same organization and reapplies the seeded scope defaults for that system role.</p>
          </div>
          <UsersRound size={19} />
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>System role</th>
                <th>Office</th>
                <th>Current group</th>
                <th>Change group</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const currentGroupId = user.activeAssignments.length === 1 ? user.activeAssignments[0]?.groupId ?? "" : "";
                const pending = pendingUsers.includes(user.id);
                return (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.name}</strong>
                      <small>{user.email}</small>
                    </td>
                    <td>{user.systemRole.replaceAll("_", " ")}</td>
                    <td>{user.officeName ?? "Organization-wide"}</td>
                    <td>
                      <strong>{user.activeAssignments.length === 0 ? "Not assigned" : user.activeAssignments.map((assignment) => assignment.groupName).join(", ")}</strong>
                      <small>{summarizeAssignments(user.activeAssignments)}</small>
                    </td>
                    <td>
                      <div className="team-user-select">
                        <select
                          disabled={pending}
                          onChange={(event) => assignGroup(user.id, event.target.value)}
                          value={currentGroupId}
                        >
                          {currentGroupId ? null : <option value="" disabled>{user.activeAssignments.length > 1 ? "Multiple active groups" : "Select a group"}</option>}
                          {groups.map((group) => (
                            <option key={group.id} value={group.id}>
                              {group.name}
                            </option>
                          ))}
                        </select>
                        {pending ? <LoaderCircle className="spin" size={15} /> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
