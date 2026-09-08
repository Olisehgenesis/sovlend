import { FileSearch, Search } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportPicker } from "@/components/report-picker";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";
import { searchClientsForStatement } from "@/modules/reports/domain/client-statement-report";

export default async function ClientStatementSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportClientStatement,
  );
  if (!allowed) redirect("/reports");

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const [results, pickerOptions] = await Promise.all([
    searchClientsForStatement(prisma, scope, query),
    loadReportPickerOptions(prisma, session.user.id, scope.organizationId),
  ]);

  return (
    <main className="directory-page statement-page">
      <Breadcrumbs items={[{ label: "Reports", href: "/reports" }, { label: "Client Statement" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Client report</p>
          <h1>Client statement</h1>
          <p>Search a client by name, account number, external id, or mobile number to print their full financial statement.</p>
        </div>
        <ReportPicker current="/reports/client-statement" options={pickerOptions} />
        <div className="header-actions">
          <Link className="secondary-action" href="/reports">
            Reports
          </Link>
        </div>
      </header>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Find a client</h2>
            <p>Only clients within your assigned scope will match.</p>
          </div>
        </div>
        <form className="entity-form compact-mapping" method="GET">
          <fieldset>
            <legend>Search</legend>
            <div className="form-row">
              <label>
                Name, account #, external id, or mobile
                <input defaultValue={query} name="q" placeholder="e.g. Sanyu Agnes or 000000910" type="text" />
              </label>
            </div>
          </fieldset>
          <div className="form-actions">
            <button className="invest-button" type="submit">
              <Search size={16} /> Search
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Results</h2>
            <p>{query ? `${results.length} match(es) for "${query}"` : "Enter a search term above"}</p>
          </div>
          <FileSearch size={19} />
        </div>
        {query && results.length === 0 ? (
          <div className="empty-state">
            <FileSearch size={28} />
            <strong>No matching clients</strong>
            <p>Check the spelling or try a different account number.</p>
          </div>
        ) : (
          <div className="statement-search-results" style={{ padding: results.length ? "14px 18px" : 0 }}>
            {results.map((client) => (
              <Link className="statement-search-row" href={`/reports/client-statement/${client.accountNumber}`} key={client.id}>
                <span>
                  <strong>{client.fullName}</strong>
                  <small>
                    {client.accountNumber} · {client.officeName}
                    {client.mobileNumber ? ` · ${client.mobileNumber}` : ""}
                  </small>
                </span>
                <span className={`status ${client.status === "ACTIVE" ? "up-to-date" : "review"}`}>{client.status}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
