import { CircleDollarSign, Plus } from "lucide-react";
import type { LoanApplicationStatus, Prisma } from "@prisma/client";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { LiveSearchInput } from "@/components/live-search-input";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { formatMinor } from "@/modules/money/domain/format-minor";

const statusAliasToValue: Record<string, LoanApplicationStatus> = {
  approved: "APPROVED",
  disbursed: "DISBURSED",
  draft: "DRAFT",
  rejected: "REJECTED",
  submitted: "SUBMITTED",
  withdrawn: "WITHDRAWN",
};

export default async function LoanApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string; page?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const params = await searchParams;
  const query = params.query?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const pageSize = 20;

  const searchFilters: Prisma.LoanApplicationWhereInput[] = [];
  if (query) {
    const normalized = query.toLowerCase();
    const status = statusAliasToValue[normalized];
    if (status) searchFilters.push({ status });
    searchFilters.push({ product: { name: { contains: query, mode: "insensitive" } } });
    searchFilters.push({ client: { firstName: { contains: query, mode: "insensitive" } } });
    searchFilters.push({ client: { lastName: { contains: query, mode: "insensitive" } } });
    searchFilters.push({ client: { accountNumber: { contains: query } } });
    searchFilters.push({ group: { name: { contains: query, mode: "insensitive" } } });
    searchFilters.push({ group: { accountNumber: { contains: query } } });
    searchFilters.push({ office: { name: { contains: query, mode: "insensitive" } } });
    searchFilters.push({ loan: { accountNumber: { contains: query } } });
  }

  const where: Prisma.LoanApplicationWhereInput = {
    office: { organizationId: scope.organizationId },
    ...officeWhere(scope),
    ...(searchFilters.length > 0 ? { AND: [{ OR: searchFilters }] } : {}),
  };

  const [applications, total] = await Promise.all([
    prisma.loanApplication.findMany({
      where,
      include: {
        client: true,
        group: true,
        loan: { select: { id: true, accountNumber: true, status: true } },
        office: { select: { name: true } },
        product: true,
      },
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.loanApplication.count({ where }),
  ]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const borrowerLabel = (application: (typeof applications)[number]) =>
    application.client
      ? `${application.client.firstName} ${application.client.lastName}`
      : `Group: ${application.group?.name ?? "Unknown"}`;
  const borrowerAccount = (application: (typeof applications)[number]) =>
    application.client?.accountNumber ?? application.group?.accountNumber ?? "—";

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[{ label: "Loans", href: "/loans" }, { label: "Applications" }]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Lending operations</p>
          <h1>Loan applications</h1>
          <p>{total.toLocaleString()} applications in your office scope</p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href="/loans">
            Overview
          </Link>
          <Link className="invest-button" href="/loans/new">
            <Plus size={16} /> New application
          </Link>
        </div>
      </header>
      <LiveSearchInput placeholder="Search borrower, office, product, loan account or status" />
      <section className="panel">
        {applications.length === 0 ? (
          <div className="empty-state">
            <CircleDollarSign size={28} />
            <strong>No matching applications</strong>
            <p>Change the search and try again.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Borrower</th>
                  <th>Product</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th>Office</th>
                  <th>Loan account</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((application) => {
                  const borrower = borrowerLabel(application);
                  return (
                    <tr key={application.id}>
                      <td>
                        <strong>{borrower}</strong>
                        <div className="muted-text mono">{borrowerAccount(application)}</div>
                        <Link
                          aria-label={`Open loan application for ${borrower}`}
                          className="row-link"
                          href={`/loans/applications/${application.id}`}
                        />
                      </td>
                      <td>{application.product.name}</td>
                      <td>
                        {formatMinor(
                          application.approvedPrincipalMinor ??
                            application.proposedPrincipalMinor,
                          application.product.denominationCurrency,
                        )}
                      </td>
                      <td>
                        <span
                          className={`status ${application.status === "APPROVED" || application.status === "DISBURSED" ? "up-to-date" : application.status === "REJECTED" ? "in-arrears" : "review"}`}
                        >
                          {application.status.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td>
                        {application.submittedAt?.toLocaleDateString() ?? "Not submitted"}
                      </td>
                      <td>{application.office.name}</td>
                      <td style={{ position: "relative", zIndex: 1 }}>
                        {application.loan ? (
                          <Link className="green-link" href={`/loans/${application.loan.id}`}>
                            {application.loan.accountNumber}
                          </Link>
                        ) : (
                          <span className="muted-text">No loan created</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <nav className="pagination" aria-label="Loan application pages">
          <Link
            aria-disabled={page <= 1}
            href={`/loans/applications?query=${encodeURIComponent(query)}&page=${Math.max(1, page - 1)}`}
          >
            Previous
          </Link>
          <span>
            Page {page} of {pages}
          </span>
          <Link
            aria-disabled={page >= pages}
            href={`/loans/applications?query=${encodeURIComponent(query)}&page=${Math.min(pages, page + 1)}`}
          >
            Next
          </Link>
        </nav>
      </section>
    </main>
  );
}
