import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";

import {
  formatUgDateTime,
  getLoanBorrowerAccount,
  getLoanBorrowerLabel,
  getLoanRouteContext,
} from "../../_lib/loan-records";

export default async function LoanDocumentPage({
  params,
}: {
  params: Promise<{ id: string; documentId: string }>;
}) {
  const { id, documentId } = await params;
  const { loan } = await getLoanRouteContext(id);

  const document = await prisma.document.findFirst({
    where: { id: documentId, loanId: loan.id },
    select: {
      id: true,
      name: true,
      description: true,
      mediaType: true,
      sha256: true,
      createdAt: true,
    },
  });

  if (!document) notFound();

  const isImage = document.mediaType.startsWith("image/");

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Loans", href: "/loans" },
          { label: loan.accountNumber, href: `/loans/${loan.id}?tab=documents` },
          { label: "Documents", href: `/loans/${loan.id}?tab=documents` },
          { label: document.name },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Loan document</p>
          <h1>{document.name}</h1>
          <p>
            {getLoanBorrowerLabel(loan)} · {document.mediaType}
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href={`/loans/${loan.id}?tab=documents`}>
            Back to documents
          </Link>
          <a className="invest-button" href={`/api/documents/${document.id}`}>
            Download document
          </a>
        </div>
      </header>
      <section className="panel review-summary">
        <div className="panel-heading">
          <div>
            <h2>Document details</h2>
            <p>Metadata and access for this supporting loan file.</p>
          </div>
        </div>
        <dl className="detail-grid">
          <div>
            <dt>Loan account</dt>
            <dd>{loan.accountNumber}</dd>
          </div>
          <div>
            <dt>Borrower</dt>
            <dd>
              {getLoanBorrowerLabel(loan)} · {getLoanBorrowerAccount(loan)}
            </dd>
          </div>
          <div>
            <dt>Description</dt>
            <dd>{document.description ?? "No description provided"}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{document.mediaType}</dd>
          </div>
          <div>
            <dt>Uploaded</dt>
            <dd>{formatUgDateTime(document.createdAt)}</dd>
          </div>
          <div>
            <dt>SHA-256</dt>
            <dd className="mono">{document.sha256}</dd>
          </div>
        </dl>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{isImage ? "Preview" : "File access"}</h2>
            <p>
              {isImage
                ? "Image documents render inline for quick review."
                : "Open or download the original file using the action above."}
            </p>
          </div>
        </div>
        {isImage ? (
          <div style={{ padding: "18px" }}>
            <img
              alt={document.name}
              src={`/api/documents/${document.id}`}
              style={{ display: "block", maxWidth: "100%", height: "auto" }}
            />
          </div>
        ) : (
          <div className="empty-state compact-empty">
            <strong>Preview not available inline</strong>
            <p>Use the download button to inspect the original document.</p>
          </div>
        )}
      </section>
    </main>
  );
}
