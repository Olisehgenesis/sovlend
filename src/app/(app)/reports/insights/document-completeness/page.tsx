import { FileWarning } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatDisplayDateTime, loadDocumentCompletenessReport } from "@/modules/reports/domain/insights-report";

export default async function DocumentCompletenessReportPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportDocumentCompleteness,
  );
  if (!allowed) redirect("/reports");

  const report = await loadDocumentCompletenessReport(prisma, scope);
  const highestPriorityRows = report.rows.filter((row) => row.missingAllDocuments).slice(0, 25);

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Reports", href: "/reports" }, { label: "Insights", href: "/reports" }, { label: "KYC/document completeness" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">SovLend-only insight</p>
          <h1>KYC / document completeness report</h1>
          <p>{report.summary.loanCount.toLocaleString()} active or in-arrears loans · {report.summary.missingAllDocumentsCount.toLocaleString()} with no documents at all</p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href="/reports">All reports</Link>
          <Link className="secondary-action" href="/loans?status=IN_ARREARS">Loans in arrears</Link>
        </div>
      </header>

      <section className="readiness-banner attention">
        <div>
          <strong>Best-effort document matching</strong>
          <span>Coverage is inferred from fuzzy document-name patterns already in the tenant data (for example National ID, clientSignature, Loan agreement, Guarantor form). It is a gap finder, not a hard compliance gate.</span>
        </div>
        <div className="readiness-progress"><i style={{ width: "100%" }} /></div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Coverage summary</h2>
            <p>Generated {formatDisplayDateTime(new Date(report.generatedAt))}</p>
          </div>
          <FileWarning size={19} />
        </div>
        <dl className="detail-grid">
          <div><dt>Loans with no documents</dt><dd>{report.summary.missingAllDocumentsCount.toLocaleString()}</dd></div>
          <div><dt>Fully matched core set</dt><dd>{report.summary.fullyMatchedCount.toLocaleString()}</dd></div>
          <div><dt>Partially matched core set</dt><dd>{report.summary.partiallyMatchedCount.toLocaleString()}</dd></div>
          {report.summary.categoryCoverage.map((category) => (
            <div key={category.key}><dt>{category.label}</dt><dd>{category.coveredLoans.toLocaleString()} loans</dd></div>
          ))}
        </dl>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Highest-priority gaps</h2>
            <p>Loans missing every linked document</p>
          </div>
        </div>
        {highestPriorityRows.length === 0 ? (
          <div className="empty-state compact-empty">
            <FileWarning size={26} />
            <strong>Every in-scope loan has at least one document</strong>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Loan</th>
                  <th>Borrower</th>
                  <th>Status</th>
                  <th>Guarantors</th>
                  <th>Gap</th>
                </tr>
              </thead>
              <tbody>
                {highestPriorityRows.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{row.accountNumber}</td>
                    <td>
                      <strong>{row.borrowerName}</strong>
                      <small>{row.borrowerAccountNumber ?? "No borrower account number"}</small>
                    </td>
                    <td><span className={`status ${row.status === "IN_ARREARS" ? "in-arrears" : "review"}`}>{row.status.replaceAll("_", " ")}</span></td>
                    <td>{row.guarantorCount}</td>
                    <td><strong>No linked loan or client documents</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Loan-by-loan completeness</h2>
            <p>Core categories present vs missing</p>
          </div>
        </div>
        {report.rows.length === 0 ? (
          <div className="empty-state">
            <FileWarning size={28} />
            <strong>No active or in-arrears loans found</strong>
            <p>This report only evaluates currently exposed loans.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Loan</th>
                  <th>Borrower</th>
                  <th>Status</th>
                  <th>Documents</th>
                  <th>Present core docs</th>
                  <th>Missing core docs</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{row.accountNumber}</td>
                    <td>
                      <strong>{row.borrowerName}</strong>
                      <small>{row.borrowerAccountNumber ?? "No borrower account number"}</small>
                    </td>
                    <td><span className={`status ${row.status === "IN_ARREARS" ? "in-arrears" : "review"}`}>{row.status.replaceAll("_", " ")}</span></td>
                    <td>
                      <strong>{row.documentCount} files</strong>
                      {row.documentNames.length > 0 ? (
                        <details>
                          <summary>View names</summary>
                          <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{row.documentNames.join("\n")}</pre>
                        </details>
                      ) : (
                        <small>No loan/client documents linked</small>
                      )}
                    </td>
                    <td>{row.presentCategories.length > 0 ? row.presentCategories.join(", ") : "—"}</td>
                    <td>{row.missingCategories.join(", ")}</td>
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
