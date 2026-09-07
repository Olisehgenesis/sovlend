import { Download, Users } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportPicker } from "@/components/report-picker";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";
import {
  clientStatusTone,
  formatReportDate,
  kycStatusTone,
  loadClientListingReport,
  loadOperationsReportContext,
} from "@/modules/reports/domain/operations-report";

export default async function ClientListingPage({
  searchParams,
}: {
  searchParams: Promise<{ officeId?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportClientListing,
    { includeReferenceData: true },
  );
  if (!context) redirect("/");
  if (!context.allowed) redirect("/reports");

  const params = await searchParams;
  const [report, pickerOptions] = await Promise.all([
    loadClientListingReport(prisma, context.scope, {
      officeId: params.officeId,
    }),
    loadReportPickerOptions(prisma, session.user.id, context.scope.organizationId),
  ]);
  const exportHref = params.officeId
    ? `/api/reports/operations/client-listing?officeId=${encodeURIComponent(params.officeId)}&format=csv`
    : "/api/reports/operations/client-listing?format=csv";

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: "Operations" },
          { label: "Client Listing" },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Operations report</p>
          <h1>Client listing</h1>
          <p>Exportable client directory for onboarding, servicing, and branch-level reviews.</p>
        </div>
        <ReportPicker current="/reports/operations/client-listing" options={pickerOptions} />
        <div className="header-actions">
          <Link className="secondary-action" href="/reports">
            Reports
          </Link>
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
        </div>
      </header>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Filters</h2>
            <p>Limit the directory to one office before exporting.</p>
          </div>
        </div>
        <form className="entity-form compact-mapping" method="GET">
          <fieldset>
            <legend>Office scope</legend>
            <div className="form-row">
              <label>
                Office
                <select defaultValue={params.officeId ?? ""} name="officeId">
                  <option value="">All offices</option>
                  {context.offices.map((office) => (
                    <option key={office.id} value={office.id}>
                      {office.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>
          <div className="form-actions">
            <button className="invest-button" type="submit">
              Apply filters
            </button>
            <Link className="secondary-action" href="/reports/operations/client-listing">
              Reset
            </Link>
          </div>
        </form>
      </section>

      <section className="panel loan-table">
        <div className="panel-heading">
          <div>
            <h2>Client directory</h2>
            <p>{report.rows.length.toLocaleString()} client record(s) in scope</p>
          </div>
          <Users size={19} />
        </div>
        {report.rows.length === 0 ? (
          <div className="empty-state">
            <Users size={28} />
            <strong>No clients match this office filter</strong>
            <p>Clear the filter or choose another office.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Account</th>
                  <th>Mobile</th>
                  <th>External ID</th>
                  <th>Office</th>
                  <th>Status</th>
                  <th>KYC</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.fullName}</strong>
                      <Link
                        aria-label={`Open client ${row.accountNumber}`}
                        className="row-link"
                        href={`/clients/${row.accountNumber}`}
                      />
                    </td>
                    <td className="mono">{row.accountNumber}</td>
                    <td>{row.mobileNumber ?? "Not provided"}</td>
                    <td>{row.externalId ?? "—"}</td>
                    <td>{row.officeName}</td>
                    <td>
                      <span className={`status ${clientStatusTone(row.status)}`}>{row.status}</span>
                    </td>
                    <td>
                      <span className={`status ${kycStatusTone(row.kycStatus)}`}>
                        {row.kycStatus}
                      </span>
                    </td>
                    <td>{formatReportDate(row.joinedOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
