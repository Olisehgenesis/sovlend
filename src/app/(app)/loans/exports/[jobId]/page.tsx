import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  AuthorizationService,
  PermissionDeniedError,
} from "@/modules/identity/application/authorization-service";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

const scopeLabels: Record<string, string> = {
  FILTERED: "Filtered set",
  PORTFOLIO: "Full portfolio",
  SINGLE_LOAN: "Single loan",
};

const dateFormatter = new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" });
const dateTimeFormatter = new Intl.DateTimeFormat("en-UG", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value: Date | null) {
  return value ? dateFormatter.format(value) : "—";
}

function formatDateTime(value: Date | null) {
  return value ? dateTimeFormatter.format(value) : "—";
}

function formatBytes(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default async function LoanExportJobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  try {
    await new AuthorizationService(prisma).assertAllowed({
      actorUserId: session.user.id,
      permission: permissions.loanView,
      organizationId: scope.organizationId,
      officeId: scope.officeIds?.[0] ?? null,
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) redirect("/loans");
    throw error;
  }

  const { jobId } = await params;
  const job = await prisma.loanExportJob.findFirst({
    where: {
      id: jobId,
      organizationId: scope.organizationId,
      requestedById: session.user.id,
    },
  });

  if (!job) notFound();

  const scopeParams = isRecord(job.scopeParams) ? job.scopeParams : null;
  const manifest = isRecord(job.manifest) ? job.manifest : null;
  const datasetCounts = isRecord(manifest?.datasetCounts)
    ? Object.entries(manifest.datasetCounts)
    : [];
  const loanCount = typeof manifest?.loanCount === "number" ? manifest.loanCount : null;
  const singleLoanId = typeof scopeParams?.loanId === "string" ? scopeParams.loanId : null;
  const linkedLoan = singleLoanId
    ? await prisma.loan.findFirst({
        where: {
          id: singleLoanId,
          office: { organizationId: scope.organizationId },
          ...officeWhere(scope),
        },
        select: { id: true, accountNumber: true },
      })
    : null;

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Loans", href: "/loans" },
          { label: "Full export", href: "/loans/exports" },
          { label: job.id.slice(0, 8) },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Loan export job</p>
          <h1>{job.id.slice(0, 8)}</h1>
          <p>Requested {formatDateTime(job.createdAt)}</p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href="/loans/exports">
            Back to exports
          </Link>
          {job.status === "COMPLETED" ? (
            <a className="invest-button" href={`/api/loans/export-jobs/${job.id}/download`}>
              Download package
            </a>
          ) : null}
        </div>
      </header>
      <section className="panel review-summary">
        <div className="panel-heading">
          <div>
            <h2>Job details</h2>
            <p>Background export state, timing, and package metadata.</p>
          </div>
          <span
            className={`status status-prominent ${job.status === "COMPLETED" ? "up-to-date" : job.status === "FAILED" ? "in-arrears" : "review"}`}
          >
            {job.status}
          </span>
        </div>
        <dl className="detail-grid">
          <div>
            <dt>Scope</dt>
            <dd>{scopeLabels[job.scopeType] ?? job.scopeType}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>{job.format === "CSV_ZIP" ? "CSV zip" : "JSON"}</dd>
          </div>
          <div>
            <dt>As of date</dt>
            <dd>{formatDate(job.asOfDate)}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{formatDateTime(job.startedAt)}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{formatDateTime(job.completedAt)}</dd>
          </div>
          <div>
            <dt>Loan count</dt>
            <dd>{loanCount ?? "—"}</dd>
          </div>
          <div>
            <dt>Package size</dt>
            <dd>{formatBytes(job.resultByteSize)}</dd>
          </div>
          <div>
            <dt>Checksum</dt>
            <dd className="mono">{job.resultSha256 ?? "—"}</dd>
          </div>
          <div>
            <dt>Linked loan</dt>
            <dd>
              {linkedLoan ? (
                <Link className="green-link" href={`/loans/${linkedLoan.id}`}>
                  {linkedLoan.accountNumber}
                </Link>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt>Error</dt>
            <dd>{job.errorMessage ?? "—"}</dd>
          </div>
        </dl>
      </section>
      {datasetCounts.length > 0 ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Dataset counts</h2>
              <p>Files included in the generated package.</p>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Dataset</th>
                  <th>Records</th>
                </tr>
              </thead>
              <tbody>
                {datasetCounts.map(([name, count]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{typeof count === "number" ? count : String(count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {scopeParams ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Scope parameters</h2>
              <p>Exact filters stored with the export request.</p>
            </div>
          </div>
          <pre style={{ margin: 0, padding: "18px", overflowX: "auto" }}>
            {JSON.stringify(scopeParams, null, 2)}
          </pre>
        </section>
      ) : null}
    </main>
  );
}
