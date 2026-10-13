import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { buildReportQueryString, formatReportDate, getGeneralLedgerJournal } from "@/modules/reports/domain/accounting-report";

export default async function LedgerEntryPage({
  params, searchParams,
}: {
  params: Promise<{ journalId: string }>;
  searchParams: Promise<{ startDate?: string; endDate?: string; officeId?: string; accountId?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");
  if (!await new AuthorizationService(prisma).isAllowedForOrganization(session.user.id, scope.organizationId, permissions.reportGeneralLedger)) redirect("/reports");
  const { journalId } = await params;
  if (!z.uuid().safeParse(journalId).success) notFound();
  const filters = await searchParams;
  const query = buildReportQueryString({ startDate: filters.startDate, endDate: filters.endDate, officeId: filters.officeId });
  const ledgerHref = `/reports/accounting/general-ledger?${buildReportQueryString({ ...filters })}`;
  const journal = await getGeneralLedgerJournal(prisma, scope, journalId);
  if (!journal) notFound();
  const totals = new Map<string, { debit: bigint; credit: bigint }>();
  for (const line of journal.lines) {
    const total = totals.get(line.account.currencyCode) ?? { debit: 0n, credit: 0n };
    if (line.direction === "DEBIT") total.debit += line.amountMinor;
    else total.credit += line.amountMinor;
    totals.set(line.account.currencyCode, total);
  }
  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Reports", href: "/reports" }, { label: "General Ledger", href: ledgerHref }, { label: "Journal entry" }]} />
      <header className="directory-header">
        <div><p className="eyebrow">Posted journal</p><h1>{journal.referenceType.replaceAll("_", " ")}</h1><p>{formatReportDate(journal.businessDate)} · {journal.office.name}</p></div>
        <Link className="secondary-action" href={ledgerHref}>Back to ledger</Link>
      </header>
      <section className="panel">
        <div className="panel-heading"><h2>Entry details</h2><span className="status up-to-date">{journal.status}</span></div>
        <dl className="detail-grid">
          <div><dt>Journal ID</dt><dd>{journal.id}</dd></div>
          <div><dt>Narration</dt><dd>{journal.narration}</dd></div>
          <div><dt>Vendor / client</dt><dd>{journal.payeeName ?? "Not recorded"}</dd></div>
          <div><dt>Payee reference</dt><dd>{journal.payeeReference ?? "Not recorded"}</dd></div>
          <div><dt>Source reference</dt><dd>{journal.referenceId ?? "Not recorded"}</dd></div>
          <div><dt>Posted at</dt><dd>{journal.postedAt?.toISOString() ?? "Not recorded"}</dd></div>
          {journal.reversalOf ? <div><dt>Reversal of</dt><dd><Link className="green-link" href={`/reports/accounting/general-ledger/entries/${journal.reversalOf.id}?${query}`}>Open original entry</Link></dd></div> : null}
          {journal.reversedBy ? <div><dt>Reversed by</dt><dd><Link className="green-link" href={`/reports/accounting/general-ledger/entries/${journal.reversedBy.id}?${query}`}>Open reversal entry</Link></dd></div> : null}
        </dl>
        <div className="table-scroll">
          <table><thead><tr><th>GL account</th><th>Type</th><th>Memo</th><th>Debit</th><th>Credit</th></tr></thead>
            <tbody>{journal.lines.map((line) => <tr key={line.id}>
              <td><Link className="green-link" href={`/reports/accounting/general-ledger/accounts/${line.accountId}?${query}`}>{line.account.code} · {line.account.name}</Link></td>
              <td>{line.account.type}</td><td>{line.memo ?? journal.narration}</td>
              <td className="mono">{line.direction === "DEBIT" ? formatMinor(line.amountMinor, line.account.currencyCode) : "—"}</td>
              <td className="mono">{line.direction === "CREDIT" ? formatMinor(line.amountMinor, line.account.currencyCode) : "—"}</td>
            </tr>)}</tbody>
            <tfoot>{[...totals].map(([currency, total]) => <tr key={currency}><td colSpan={3}><strong>{currency} totals</strong></td><td className="mono">{formatMinor(total.debit, currency)}</td><td className="mono">{formatMinor(total.credit, currency)}</td></tr>)}</tfoot>
          </table>
        </div>
      </section>
    </main>
  );
}
