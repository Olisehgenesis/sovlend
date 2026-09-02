import { CircleDollarSign, Download, Plus } from "lucide-react";
import type { LoanStatus, Prisma } from "@prisma/client";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LiveSearchInput } from "@/components/live-search-input";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatMinor } from "@/modules/reporting/application/dashboard";
import {
  getUserDataScope,
  officeWhere,
} from "@/modules/identity/application/data-scope";

const activeLoanStatuses: LoanStatus[] = ["ACTIVE", "IN_ARREARS", "OVERPAID"];

const statusAliasToValue: Record<string, LoanStatus> = {
  active: "ACTIVE",
  "up to date": "ACTIVE",
  uptodate: "ACTIVE",
  "in arrears": "IN_ARREARS",
  arrears: "IN_ARREARS",
  overpaid: "OVERPAID",
};

export default async function LoansPage({ searchParams }: { searchParams: Promise<{ query?: string; page?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const userScope = await getUserDataScope(prisma, session.user.id);
  if (!userScope) redirect("/");
  const params = await searchParams;
  const query = params.query?.trim() ?? "";
  const pageSize = 15;
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const searchFilters: Prisma.LoanWhereInput[] = [];
  if (query) {
    const normalized = query.toLowerCase();
    const status = statusAliasToValue[normalized];
    if (status) searchFilters.push({ status });
    searchFilters.push({ accountNumber: { contains: query, mode: "insensitive" } });
    searchFilters.push({ product: { name: { contains: query, mode: "insensitive" } } });
    searchFilters.push({ client: { firstName: { contains: query, mode: "insensitive" } } });
    searchFilters.push({ client: { lastName: { contains: query, mode: "insensitive" } } });
    searchFilters.push({ client: { accountNumber: { contains: query } } });
    searchFilters.push({ client: { mobileNumber: { contains: query } } });
    searchFilters.push({ office: { name: { contains: query, mode: "insensitive" } } });
    searchFilters.push({ loanOfficer: { is: { name: { contains: query, mode: "insensitive" } } } });
  }

  const loanWhere: Prisma.LoanWhereInput = {
    client: { organizationId: userScope.organizationId },
    ...officeWhere(userScope),
    status: { in: activeLoanStatuses },
    ...(searchFilters.length > 0 ? { AND: [{ OR: searchFilters }] } : {}),
  };

  const [products, applications, activeLoanTotal] = await Promise.all([
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
      take: 20,
    }),
    prisma.loan.count({ where: loanWhere }),
  ]);

  const pages = Math.max(1, Math.ceil(activeLoanTotal / pageSize));
  const page = Math.min(requestedPage, pages);
  const loans = await prisma.loan.findMany({
    where: loanWhere,
    include: {
      client: { include: { office: { select: { name: true } } } },
      product: true,
      loanOfficer: { select: { name: true } },
      installments: {
        select: {
          principalDueMinor: true,
          interestDueMinor: true,
          feesDueMinor: true,
          penaltiesDueMinor: true,
          principalPaidMinor: true,
          interestPaidMinor: true,
          feesPaidMinor: true,
          penaltiesPaidMinor: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  const pageWindow = paginateWindow(page, pages);
  const pageHref = (targetPage: number) => {
    const q = new URLSearchParams();
    if (query) q.set("query", query);
    q.set("page", String(targetPage));
    return `/loans?${q.toString()}`;
  };

  return (
    <main className="directory-page">
      <header className="directory-header">
        <div>
          <p className="eyebrow">Lending operations</p>
          <h1>Loans</h1>
          <p>
            {activeLoanTotal.toLocaleString()} active loan accounts · {applications.length} applications needing review
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href="/">
            Overview
          </Link>
          <a className="secondary-action" href="/api/loans/export">
            <Download size={16} /> Export CSV
          </a>
          <Link className="secondary-action" href="/loans/exports">
            <Download size={16} /> Full export
          </Link>
          <Link className="invest-button" href="/loans/new">
            <Plus size={16} /> New application
          </Link>
        </div>
      </header>
      <LiveSearchInput placeholder="Filter display by name, client account, staff, office, loan name or status" />
      <section className="loan-route-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>All active loans</h2>
              <p>Operational register for active and in-arrears accounts</p>
            </div>
            <CircleDollarSign size={19} />
          </div>
          {loans.length === 0 ? (
            <div className="empty-state">
              <CircleDollarSign size={28} />
              <strong>No matching active loans</strong>
              <p>Change the filter and try again.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="clickable-rows">
                <thead>
                  <tr>
                    <th>Account holder&apos;s name</th>
                    <th>Account ID</th>
                    <th>Loan name</th>
                    <th>Status</th>
                    <th>Loan amount</th>
                    <th>Business development officer</th>
                    <th>Principal due</th>
                    <th>Interest due</th>
                    <th>Total due</th>
                    <th>Total paid</th>
                  </tr>
                </thead>
                <tbody>
                  {loans.map((loan) => {
                    const principalDue = loan.installments.reduce((sum, item) => sum + item.principalDueMinor - item.principalPaidMinor, 0n);
                    const interestDue = loan.installments.reduce((sum, item) => sum + item.interestDueMinor - item.interestPaidMinor, 0n);
                    const feesDue = loan.installments.reduce((sum, item) => sum + item.feesDueMinor - item.feesPaidMinor, 0n);
                    const penaltiesDue = loan.installments.reduce((sum, item) => sum + item.penaltiesDueMinor - item.penaltiesPaidMinor, 0n);
                    const totalDue = principalDue + interestDue + feesDue + penaltiesDue;
                    const totalPaid = loan.installments.reduce((sum, item) => sum + item.principalPaidMinor + item.interestPaidMinor + item.feesPaidMinor + item.penaltiesPaidMinor, 0n);
                    const borrower = `${loan.client.firstName} ${loan.client.lastName}`;
                    return (
                      <tr key={loan.id}>
                        <td>
                          {borrower}
                          <Link className="row-link" href={`/loans/${loan.id}`} aria-label={`Open ${loan.accountNumber}`} />
                        </td>
                        <td className="mono">{loan.client.accountNumber}</td>
                        <td>{loan.product.name}</td>
                        <td>
                          <span className={`status ${loan.status === "ACTIVE" ? "up-to-date" : loan.status === "IN_ARREARS" ? "in-arrears" : "review"}`}>
                            {loan.status.replaceAll("_", " ")}
                          </span>
                        </td>
                        <td>{formatMinor(loan.principalMinor, loan.denominationCurrency)}</td>
                        <td>{loan.loanOfficer?.name ?? "Unassigned"}</td>
                        <td>{formatMinor(principalDue, loan.denominationCurrency)}</td>
                        <td>{formatMinor(interestDue, loan.denominationCurrency)}</td>
                        <td>{formatMinor(totalDue, loan.denominationCurrency)}</td>
                        <td>{formatMinor(totalPaid, loan.denominationCurrency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <nav className="pagination" aria-label="Active loan pages">
            <Link aria-disabled={page <= 1} href={pageHref(1)}>
              {"<<"}
            </Link>
            <Link aria-disabled={page <= 1} href={pageHref(Math.max(1, page - 1))}>
              {"<"}
            </Link>
            {pageWindow.map((item) => (
              <Link aria-current={item === page ? "page" : undefined} key={item} href={pageHref(item)}>
                {item}
              </Link>
            ))}
            <Link aria-disabled={page >= pages} href={pageHref(Math.min(pages, page + 1))}>
              {">"}
            </Link>
            <Link aria-disabled={page >= pages} href={pageHref(pages)}>
              {">>"}
            </Link>
          </nav>
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Applications queue</h2>
              <p>Maker-checker records that still need action</p>
            </div>
            <CircleDollarSign size={19} />
          </div>
          {applications.length === 0 ? (
            <div className="empty-state">
              <CircleDollarSign size={28} />
              <strong>No pending applications</strong>
              <p>Create a loan application to begin the workflow.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Borrower</th>
                    <th>Product</th>
                    <th>Principal</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((application) => (
                    <tr key={application.id}>
                      <td>
                        {application.client.firstName} {application.client.lastName}
                      </td>
                      <td>{application.product.name}</td>
                      <td>
                        {formatMinor(
                          application.approvedPrincipalMinor ?? application.proposedPrincipalMinor,
                          application.product.denominationCurrency,
                        )}
                      </td>
                      <td>
                        <span className={`status ${application.status === "SUBMITTED" ? "review" : "up-to-date"}`}>
                          {application.status.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td>
                        <Link className="green-link" href={`/loans/applications/${application.id}`}>
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
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
                      -{" "}
                      {formatMinor(
                        product.principalMaxMinor,
                        product.denominationCurrency,
                      )}
                    </td>
                    <td>{(product.annualRateBps / 100).toFixed(2)}%</td>
                    <td>
                      {product.repaymentCount} | {product.repaymentFrequency}
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

function paginateWindow(page: number, totalPages: number) {
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  const pages: number[] = [];
  for (let current = start; current <= end; current += 1) pages.push(current);
  return pages;
}
