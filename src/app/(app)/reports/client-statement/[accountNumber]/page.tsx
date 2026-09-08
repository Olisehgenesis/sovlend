import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { OrganizationLetterhead } from "@/components/organization-letterhead";
import { PrintStatementButton } from "@/components/print-statement-button";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { loadClientStatement } from "@/modules/reports/domain/client-statement-report";
import { clientStatusTone, formatLoanStatus, formatReportDate, loanStatusTone } from "@/modules/reports/domain/operations-report";
import { savingsStatusTone } from "@/modules/reports/domain/savings-report";

export default async function ClientStatementPage({ params }: { params: Promise<{ accountNumber: string }> }) {
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

  const { accountNumber } = await params;
  const statement = await loadClientStatement(prisma, scope, accountNumber);
  if (!statement) notFound();

  const { client, loans, savingsAccounts, charges, totals } = statement;

  return (
    <main className="directory-page statement-page">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: "Client Statement", href: "/reports/client-statement" },
          { label: client.fullName },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Client report</p>
          <h1>{client.fullName}</h1>
          <p>Account #{client.accountNumber} · {client.officeName}</p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href="/reports/client-statement">
            Search
          </Link>
          <Link className="secondary-action" href={`/clients/${client.accountNumber}`}>
            Open client record
          </Link>
          <PrintStatementButton />
        </div>
      </header>

      <article className="statement-sheet">
        <OrganizationLetterhead />

        <div className="statement-client">
          <div>
            <span>Client</span>
            <strong>{client.fullName}</strong>
          </div>
          <div>
            <span>Account #</span>
            <strong>{client.accountNumber}</strong>
          </div>
          <div>
            <span>External ID</span>
            <strong>{client.externalId ?? "—"}</strong>
          </div>
          <div>
            <span>Mobile</span>
            <strong>{client.mobileNumber ?? "—"}</strong>
          </div>
          <div>
            <span>Office</span>
            <strong>{client.officeName}</strong>
          </div>
          <div>
            <span>Loan officer</span>
            <strong>{client.assignedOfficerName ?? "Unassigned"}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>
              <span className={`status ${clientStatusTone(client.status)}`}>{client.status}</span>
            </strong>
          </div>
          <div>
            <span>Joined</span>
            <strong>{formatReportDate(client.joinedOn)}</strong>
          </div>
          <div>
            <span>As of</span>
            <strong>{formatReportDate(statement.asOf)}</strong>
          </div>
        </div>

        <div className="statement-section">
          <h3>Financial position summary</h3>
          <div className="statement-totals">
            <div>
              <span>Principal disbursed</span>
              <strong>{formatMinor(totals.totalPrincipalDisbursedMinor, totals.currencyCode)}</strong>
            </div>
            <div>
              <span>Total paid (all loans)</span>
              <strong>{formatMinor(totals.totalPaidMinor, totals.currencyCode)}</strong>
            </div>
            <div>
              <span>Loan outstanding</span>
              <strong>{formatMinor(totals.totalLoanOutstandingMinor, totals.currencyCode)}</strong>
            </div>
            <div>
              <span>Savings balance</span>
              <strong>{formatMinor(totals.totalSavingsBalanceMinor, totals.currencyCode)}</strong>
            </div>
          </div>
        </div>

        <div className="statement-section">
          <h3>Loans ({loans.length})</h3>
          {loans.length === 0 ? (
            <p className="muted-text">No loan accounts on record.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Product</th>
                    <th>Status</th>
                    <th>Disbursed</th>
                    <th>Principal</th>
                    <th>Principal paid</th>
                    <th>Interest paid</th>
                    <th>Total paid</th>
                    <th>Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {loans.map((loan) => (
                    <tr key={loan.id}>
                      <td className="mono">{loan.accountNumber}</td>
                      <td>{loan.productName}</td>
                      <td>
                        <span className={`status ${loanStatusTone(loan.status)}`}>{formatLoanStatus(loan.status)}</span>
                      </td>
                      <td>{formatReportDate(loan.disbursedOn)}</td>
                      <td>{formatMinor(loan.principalMinor, loan.currencyCode)}</td>
                      <td>{formatMinor(loan.principalPaidMinor, loan.currencyCode)}</td>
                      <td>{formatMinor(loan.interestPaidMinor, loan.currencyCode)}</td>
                      <td>{formatMinor(loan.totalPaidMinor, loan.currencyCode)}</td>
                      <td>{formatMinor(loan.outstandingMinor, loan.currencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="statement-section">
          <h3>Savings accounts ({savingsAccounts.length})</h3>
          {savingsAccounts.length === 0 ? (
            <p className="muted-text">No savings accounts on record.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Product</th>
                    <th>Status</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {savingsAccounts.map((account) => (
                    <tr key={account.id}>
                      <td className="mono">{account.accountNumber}</td>
                      <td>{account.productName}</td>
                      <td>
                        <span className={`status ${savingsStatusTone(account.status)}`}>{account.status}</span>
                      </td>
                      <td>{formatMinor(account.balanceMinor, account.currencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="statement-section">
          <h3>Charges ({charges.length})</h3>
          {charges.length === 0 ? (
            <p className="muted-text">No charges on record.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Loan</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {charges.map((charge) => (
                    <tr key={charge.id}>
                      <td>{charge.name}</td>
                      <td className="mono">{charge.loanAccountNumber ?? "—"}</td>
                      <td>{formatReportDate(charge.dueOn)}</td>
                      <td>
                        <span className={`status ${charge.status === "PAID" ? "up-to-date" : charge.status === "WAIVED" ? "review" : "in-arrears"}`}>
                          {charge.status}
                        </span>
                      </td>
                      <td>{formatMinor(charge.amountMinor, charge.currencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted-text" style={{ marginTop: 10 }}>
            Total outstanding charges: {formatMinor(totals.totalChargesOutstandingMinor, totals.currencyCode)}
          </p>
        </div>

        <div className="statement-footer">
          This statement reflects the client&apos;s position as of {formatReportDate(statement.asOf)} and was generated by SovLend on behalf of
          JUMPSTART Africa Investment Services LTD. For any discrepancy, please contact your branch office.
        </div>
      </article>
    </main>
  );
}
