import { CircleDollarSign, Download, Plus } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatMinor } from "@/modules/reporting/application/dashboard";
import {
  getUserDataScope,
  officeWhere,
} from "@/modules/identity/application/data-scope";

export default async function LoansPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const userScope = await getUserDataScope(prisma, session.user.id);
  if (!userScope) redirect("/");
  const [products, applications, loans] = await Promise.all([
    prisma.loanProduct.findMany({
      where: { organizationId: userScope.organizationId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    prisma.loanApplication.findMany({
      where: {
        client: {
          organizationId: userScope.organizationId,
          ...officeWhere(userScope),
        },
      },
      include: { client: true, product: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.loan.findMany({
      where: {
        client: { organizationId: userScope.organizationId },
        ...officeWhere(userScope),
      },
      include: { client: true, product: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  return (
    <main className="directory-page">
      <header className="directory-header">
        <div>
          <p className="eyebrow">Lending operations</p>
          <h1>Loans</h1>
          <p>
            {loans.length} loan accounts · {applications.length} applications
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href="/">
            Overview
          </Link>
          <a className="secondary-action" href="/api/loans/export">
            <Download size={16} /> Export CSV
          </a>
          <Link className="invest-button" href="/loans/new">
            <Plus size={16} /> New application
          </Link>
        </div>
      </header>
      <section className="loan-route-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Applications and accounts</h2>
              <p>Branch-scoped operational records</p>
            </div>
            <CircleDollarSign size={19} />
          </div>
          {applications.length === 0 && loans.length === 0 ? (
            <div className="empty-state">
              <CircleDollarSign size={28} />
              <strong>No loan records yet</strong>
              <p>
                Create a loan application to begin the maker-checker workflow.
              </p>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Borrower</th>
                    <th>Product</th>
                    <th>Principal</th>
                    <th>Loan account</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((application) => {
                    const loan = loans.find(
                      (item) => item.applicationId === application.id,
                    );
                    const actionLabel = !loan
                      ? "Review application"
                      : loan.status === "APPROVED"
                        ? "Prepare disbursement"
                        : ["ACTIVE", "IN_ARREARS", "OVERPAID"].includes(loan.status)
                          ? "Service loan"
                          : "View details";
                    const actionHref = loan && loan.status !== "APPROVED"
                      ? `/loans/${loan.id}`
                      : `/loans/applications/${application.id}`;
                    return (
                      <tr key={application.id}>
                        <td>
                          {application.client.firstName}{" "}
                          {application.client.lastName}
                        </td>
                        <td>{application.product.name}</td>
                        <td>
                          {formatMinor(
                            application.approvedPrincipalMinor ??
                              application.proposedPrincipalMinor,
                            application.product.denominationCurrency,
                          )}
                        </td>
                        <td className="mono">
                          {loan ? (
                            <Link
                              className="green-link"
                              href={`/loans/${loan.id}`}
                            >
                              {loan.accountNumber}
                            </Link>
                          ) : (
                            "Pending approval"
                          )}
                        </td>
                        <td>
                          <span
                            className={`status ${loan?.status === "ACTIVE" ? "up-to-date" : loan?.status === "IN_ARREARS" ? "in-arrears" : "review"}`}
                          >
                            {(loan?.status ?? application.status).replaceAll("_", " ")}
                          </span>
                        </td>
                        <td>
                          <Link
                            className="green-link"
                            href={actionHref}
                          >
                            {actionLabel}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Loan products</h2>
              <p>{products.length} verified configurations</p>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Principal range</th>
                  <th>Annual rate</th>
                  <th>Repayments</th>
                  <th>Method</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <strong>{product.name}</strong>
                      <small>{product.shortName}</small>
                    </td>
                    <td>
                      {formatMinor(
                        product.principalMinMinor,
                        product.denominationCurrency,
                      )}{" "}
                      –{" "}
                      {formatMinor(
                        product.principalMaxMinor,
                        product.denominationCurrency,
                      )}
                    </td>
                    <td>{(product.annualRateBps / 100).toFixed(2)}%</td>
                    <td>
                      {product.repaymentCount} · {product.repaymentFrequency}
                    </td>
                    <td>{product.interestMethod}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </main>
  );
}
