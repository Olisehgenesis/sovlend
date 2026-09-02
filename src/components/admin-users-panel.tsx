"use client";

import { LoaderCircle, Plus, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type UserSummary = { id: string; name: string; email: string; role: string | null; systemRole: string | null; banned: boolean | null; organizationName: string | null; officeName: string | null };
type OrganizationOption = { id: string; name: string };
type OfficeOption = { id: string; name: string; organizationId: string };

const systemRoles = ["ADMIN", "GENERAL_MANAGER", "BRANCH_MANAGER", "TELLER", "LOAN_OFFICER", "CLIENT", "INVESTOR", "TREASURY_SIGNER", "AUDITOR"];

export function AdminUsersPanel({ initialUsers, organizations, offices }: { initialUsers: UserSummary[]; organizations: OrganizationOption[]; offices: OfficeOption[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [pending, setPending] = useState(false);

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
    setUsers((current) => [...current, { id: created.id, name: created.name, email: created.email, role: created.role ?? null, systemRole, banned: false, organizationName: organizations.find((item) => item.id === organizationId)?.name ?? null, officeName: offices.find((item) => item.id === officeId)?.name ?? null }]);
    toast.success(`${created.name} can now sign in`);
  }

  return (
    <main className="admin-page">
      <section className="page-heading"><div><p className="eyebrow">Access administration</p><h1>Users and access</h1><p>Create controlled accounts and review their SovLend responsibilities.</p></div></section>
      <section className="admin-grid">
        <article className="panel user-list"><div className="panel-heading"><div><h2>Workspace users</h2><p>{users.length} connected identities</p></div><ShieldCheck size={19} /></div>
          <div className="table-scroll"><table><thead><tr><th>User</th><th>System role</th><th>Office</th><th>Access</th><th>Status</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.name}</strong><small>{user.email}</small></td><td>{user.systemRole?.replaceAll("_", " ") ?? "Not assigned"}</td><td>{user.officeName ?? user.organizationName ?? "Not assigned"}</td><td>{user.role === "admin" ? "Administrator" : "Standard"}</td><td><span className={`status ${user.banned ? "in-arrears" : "up-to-date"}`}>{user.banned ? "Suspended" : "Active"}</span></td></tr>)}</tbody></table></div>
        </article>
        <aside className="panel create-user"><div className="panel-heading"><div><h2>Add user</h2><p>Email and temporary password</p></div><Plus size={18} /></div>
          <form action={createUser} className="stack-form">
            <label>Name<input name="name" required autoComplete="off" /></label>
            <label>Email<input name="email" type="email" required autoComplete="off" /></label>
            <label>Temporary password<input name="password" type="password" minLength={6} required autoComplete="new-password" /></label>
            <label>Organization<select name="organizationId" required defaultValue=""><option value="" disabled>Select organization</option>{organizations.map((organization) => <option value={organization.id} key={organization.id}>{organization.name}</option>)}</select></label>
            <label>Office<select name="officeId" defaultValue=""><option value="">No office</option>{offices.map((office) => <option value={office.id} key={office.id}>{office.name}</option>)}</select></label>
            <label>System role<select name="systemRole" defaultValue="TELLER">{systemRoles.map((role) => <option value={role} key={role}>{role.replaceAll("_", " ")}</option>)}</select></label>
            <button className="primary" disabled={pending} type="submit">{pending ? <LoaderCircle className="spin" size={17} /> : <UserRound size={17} />} Create user</button>
          </form>
        </aside>
      </section>
    </main>
  );
}