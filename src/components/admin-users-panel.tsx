"use client";

import { Archive, ArchiveRestore, LoaderCircle, Plus, Search, ShieldCheck, UserRound, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EntityAvatar } from "@/components/entity-avatar";

type UserSummary = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  systemRole: string | null;
  banned: boolean | null;
  mobileNumber: string | null;
  genderCode: string | null;
  joinedOn: string | null;
  organizationName: string | null;
  officeName: string | null;
  activeLoanCount: number;
};

function formatJoinedOn(joinedOn: string | null) {
  if (!joinedOn) return "\u2014";
  return new Date(joinedOn).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

type OrganizationOption = { id: string; name: string };
type OfficeOption = { id: string; name: string; organizationId: string };
type StatusFilter = "all" | "active" | "archived";

const systemRoles = ["ADMIN", "GENERAL_MANAGER", "BRANCH_MANAGER", "TELLER", "LOAN_OFFICER", "CLIENT", "INVESTOR", "TREASURY_SIGNER", "AUDITOR"];

export function AdminUsersPanel({
  currentUserId,
  initialUsers,
  organizations,
  offices,
}: {
  currentUserId: string;
  initialUsers: UserSummary[];
  organizations: OrganizationOption[];
  offices: OfficeOption[];
}) {
  const [users, setUsers] = useState(initialUsers);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((user) => {
      const archived = Boolean(user.banned);
      if (statusFilter === "active" && archived) return false;
      if (statusFilter === "archived" && !archived) return false;
      if (!needle) return true;
      return [
        user.name,
        user.email,
        user.systemRole?.replaceAll("_", " ") ?? "",
        user.officeName ?? "",
        user.organizationName ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [users, query, statusFilter]);

  async function createUser(formData: FormData) {
    setPending(true);
    const systemRole = String(formData.get("systemRole"));
    const organizationId = String(formData.get("organizationId"));
    const officeId = String(formData.get("officeId"));
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        email: formData.get("email"),
        password: formData.get("password"),
        systemRole,
        organizationId,
        officeId: officeId || null,
      }),
    });
    const result = await response.json();
    setPending(false);

    if (!response.ok) {
      toast.error(result.error ?? "User could not be created");
      return;
    }

    const created = result.user;
    setUsers((current) => [
      {
        id: created.id,
        name: created.name,
        email: created.email,
        role: created.role ?? null,
        systemRole,
        banned: false,
        mobileNumber: null,
        genderCode: null,
        joinedOn: null,
        organizationName: organizations.find((item) => item.id === organizationId)?.name ?? null,
        officeName: offices.find((item) => item.id === officeId)?.name ?? null,
        activeLoanCount: 0,
      },
      ...current,
    ]);
    toast.success(`${created.name} can now sign in`);
  }

  return (
    <main className="admin-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Access administration</p>
          <h1>Users and access</h1>
          <p>Create controlled accounts and review their SovLend responsibilities.</p>
        </div>
      </section>
      <section className="admin-grid">
        <article className="panel user-list">
          <div className="panel-heading">
            <div>
              <h2>Workspace users</h2>
              <p>
                {filteredUsers.length} of {users.length} identities
                {statusFilter === "archived" ? " · archived cannot sign in" : ""}
              </p>
            </div>
            <ShieldCheck size={19} />
          </div>
          <div className="directory-toolbar">
            <div className="directory-search">
              <Search size={17} />
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, email, role or office"
                value={query}
              />
              {query ? (
                <button aria-label="Clear search" className="search-clear" onClick={() => setQuery("")} type="button">
                  <X size={15} />
                </button>
              ) : null}
            </div>
            <div className="directory-filter-chip">
              <span className="muted-text">Status:</span>
              {([
                ["all", "All"],
                ["active", "Active"],
                ["archived", "Archived"],
              ] as const).map(([value, label]) => (
                <button
                  aria-pressed={statusFilter === value}
                  className={`status ${statusFilter === value ? "up-to-date" : "review"}`}
                  key={value}
                  onClick={() => setStatusFilter(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>System role</th>
                  <th>Office</th>
                  <th>Joined</th>
                  <th>Access</th>
                  <th className="numeric">Active loans</th>
                  <th>Status</th>
                  <th className="table-actions" />
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={8}>No users match this search.</td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <div className="person-cell">
                          <EntityAvatar name={user.name} seed={user.id} size={28} />
                          <span className="person-copy">
                            <strong>{user.name}</strong>
                            <small>{user.email}</small>
                            {(user.mobileNumber || user.genderCode) && (
                              <small>{[user.mobileNumber, user.genderCode].filter(Boolean).join(" \u00b7 ")}</small>
                            )}
                          </span>
                        </div>
                      </td>
                      <td>{user.systemRole?.replaceAll("_", " ") ?? "Not assigned"}</td>
                      <td>{user.officeName ?? user.organizationName ?? "Not assigned"}</td>
                      <td>{formatJoinedOn(user.joinedOn)}</td>
                      <td>{user.role === "admin" ? "Administrator" : "Standard"}</td>
                      <td className="numeric">{user.activeLoanCount.toLocaleString()}</td>
                      <td>
                        <span className={`status ${user.banned ? "review" : "up-to-date"}`}>
                          {user.banned ? "Archived" : "Active"}
                        </span>
                      </td>
                      <td className="table-actions">
                        <ArchiveUserButton
                          archived={Boolean(user.banned)}
                          disabled={user.id === currentUserId}
                          onChange={(archived) => {
                            setUsers((current) =>
                              current.map((item) => (item.id === user.id ? { ...item, banned: archived } : item)),
                            );
                          }}
                          userId={user.id}
                          userName={user.name}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
        <aside className="panel create-user">
          <div className="panel-heading">
            <div>
              <h2>Add user</h2>
              <p>Email and temporary password</p>
            </div>
            <Plus size={18} />
          </div>
          <form action={createUser} className="stack-form">
            <label>
              Name
              <input autoComplete="off" name="name" required />
            </label>
            <label>
              Email
              <input autoComplete="off" name="email" required type="email" />
            </label>
            <label>
              Temporary password
              <input autoComplete="new-password" minLength={6} name="password" required type="password" />
            </label>
            <label>
              Organization
              <select defaultValue="" name="organizationId" required>
                <option disabled value="">
                  Select organization
                </option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Office
              <select defaultValue="" name="officeId">
                <option value="">No office</option>
                {offices.map((office) => (
                  <option key={office.id} value={office.id}>
                    {office.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              System role
              <select defaultValue="TELLER" name="systemRole">
                {systemRoles.map((role) => (
                  <option key={role} value={role}>
                    {role.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" disabled={pending} type="submit">
              {pending ? <LoaderCircle className="spin" size={17} /> : <UserRound size={17} />} Create user
            </button>
          </form>
        </aside>
      </section>
    </main>
  );
}

function ArchiveUserButton({
  archived,
  disabled,
  onChange,
  userId,
  userName,
}: {
  archived: boolean;
  disabled: boolean;
  onChange: (archived: boolean) => void;
  userId: string;
  userName: string;
}) {
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (disabled) {
      toast.error("You cannot archive your own account");
      return;
    }
    if (
      !archived &&
      !window.confirm(`Archive ${userName}? They will not be able to sign in. Their loans stay on the book.`)
    ) {
      return;
    }
    setPending(true);
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !archived }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Update failed");
      return;
    }
    onChange(!archived);
    toast.success(archived ? `${userName} restored` : `${userName} archived and signed out`);
  }

  return (
    <button
      className={`icon-action ${archived ? "" : "danger"}`}
      disabled={pending || disabled}
      onClick={toggle}
      title={disabled ? "You cannot archive your own account" : archived ? "Restore so they can sign in" : "Archive (cannot sign in)"}
      type="button"
    >
      {pending ? <LoaderCircle className="spin" size={14} /> : archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
    </button>
  );
}
