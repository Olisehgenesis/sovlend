import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { journalSearchHref } from "@/lib/journal-search-href";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { buildReportQueryString, formatDateInputValue, formatReportDate, getGeneralLedgerJournal } from "@/modules/reports/domain/accounting-report";

const postedAtFormatter = new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" });

function entryTitle(narration: string, referenceType: string) {
  const trimmed = narration.trim();
  if (trimmed) return trimmed;
  const label = referenceType.replaceAll("_", " ").toLowerCase();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function entryTypeLabel(referenceType: string) {
  const label = referenceType.replaceAll("_", " ").toLowerCase();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default async function LedgerEntryPage({
  params, searchParams,
}: {
  params: Promise<{ journalId: string }>;
  searchParams: Promise<{
    startDate?: string;
    endDate?: string;
    officeId?: string;
    accountId?: string;
    search?: string;
    entrySource?: string;
    minAmount?: string;
    maxAmount?: string;
    from?: string;
  }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");
  const authorization = new AuthorizationService(prisma);
  const [canReadLedger, canSearchJournals] = await Promise.all([
    authorization.isAllowedForOrganization(session.user.id, scope.organizationId, permissions.reportGeneralLedger),
    authorization.isAllowedForOrganization(session.user.id, scope.organizationId, permissions.reportJournalReconciliation),
  ]);
  if (!canReadLedger && !canSearchJournals) redirect("/reports");
  const { journalId } = await params;
  if (!z.uuid().safeParse(journalId).success) notFound();
  const filters = await searchParams;
  const journal = await getGeneralLedgerJournal(prisma, scope, journalId);
  if (!journal) notFound();
  const startDate = filters.startDate && /^\d{4}-\d{2}-\d{2}$/.test(filters.startDate)
    ? filters.startDate
    : formatDateInputValue(journal.businessDate);
  const endDate = filters.endDate && /^\d{4}-\d{2}-\d{2}$/.test(filters.endDate) ? filters.endDate : startDate;
  const fromSearch = filters.from === "search";
  const searchHref = journalSearchHref({
    startDate,
    endDate,
    officeId: filters.officeId,
    accountId: filters.accountId,
    search: filters.search,
    entrySource: filters.entrySource,
    minAmount: filters.minAmount,
    maxAmount: filters.maxAmount,
  });
  const ledgerHref = `/reports/accounting/general-ledger?${buildReportQueryString({
    startDate,
    endDate,
    officeId: filters.officeId,
    accountId: filters.accountId,
  })}`;
  const backHref = fromSearch ? searchHref : ledgerHref;
  const accountHref = (accountId: string) => fromSearch
    ? journalSearchHref({ startDate, endDate, officeId: filters.officeId, accountId })
    : `/reports/accounting/general-ledger/accounts/${accountId}?${buildReportQueryString({ startDate, endDate, officeId: filters.officeId })}`;
  const totals = new Map<string, { debit: bigint; credit: bigint }>();
  for (const line of journal.lines) {
    const total = totals.get(line.account.currencyCode) ?? { debit: 0n, credit: 0n };
    if (line.direction === "DEBIT") total.debit += line.amountMinor;
    else total.credit += line.amountMinor;
    totals.set(line.account.currencyCode, total);
  }
  const title = entryTitle(journal.narration, journal.referenceType);
  return (
    <main className="directory-page">
      <Breadcrumbs items={[
        { label: "Reports", href: "/reports" },
        fromSearch
          ? { label: "Search journal entries", href: searchHref }
          : { label: "General Ledger", href: ledgerHref },
        { label: "Journal entry" },
      ]} />
      <header className="directory-header">
        <div>
          <h1>{title}</h1>
          <p>{formatReportDate(journal.businessDate)} · {journal.office.name}</p>
        </div>
        <Link className="secondary-action" href={backHref}>{fromSearch ? "Back to transactions" : "Back to ledger"}</Link>
      </header>
      <section className="panel">
        <div className="panel-heading">
          <h2>Entry details</h2>
          <span className="status up-to-date">{journal.status.replaceAll("_", " ")}</span>
        </div>
        <dl className="detail-grid">
          <div><dt>Entry type</dt><dd>{entryTypeLabel(journal.referenceType)}</dd></div>
          <div><dt>Vendor / client</dt><dd>{journal.payeeName ?? "Not recorded"}</dd></div>
          <div><dt>Payee reference</dt><dd>{journal.payeeReference ?? "Not recorded"}</dd></div>
          <div><dt>Source reference</dt><dd>{journal.referenceId ?? "Not recorded"}</dd></div>
          <div><dt>Posted</dt><dd>{journal.postedAt ? postedAtFormatter.format(journal.postedAt) : "Not recorded"}</dd></div>
          <div><dt>Entry id</dt><dd className="entry-id">{journal.id}</dd></div>
          {journal.reversalOf ? <div><dt>Reversal of</dt><dd><Link className="green-link" href={`/reports/accounting/general-ledger/entries/${journal.reversalOf.id}?${buildReportQueryString({ startDate, endDate, officeId: filters.officeId, accountId: filters.accountId, from: filters.from })}`}>Open original entry</Link></dd></div> : null}
          {journal.reversedBy ? <div><dt>Reversed by</dt><dd><Link className="green-link" href={`/reports/accounting/general-ledger/entries/${journal.reversedBy.id}?${buildReportQueryString({ startDate, endDate, officeId: filters.officeId, accountId: filters.accountId, from: filters.from })}`}>Open reversal entry</Link></dd></div> : null}
        </dl>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th>Memo</th>
                <th className="numeric">Debit</th>
                <th className="numeric">Credit</th>
              </tr>
            </thead>
            <tbody>
              {journal.lines.map((line) => (
                <tr key={line.id}>
                  <td><Link className="green-link" href={accountHref(line.accountId)}>{line.account.code} · {line.account.name}</Link></td>
                  <td>{line.account.type}</td>
                  <td>{line.memo ?? journal.narration}</td>
                  <td className="numeric">{line.direction === "DEBIT" ? formatMinor(line.amountMinor, line.account.currencyCode) : "—"}</td>
                  <td className="numeric">{line.direction === "CREDIT" ? formatMinor(line.amountMinor, line.account.currencyCode) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {[...totals].map(([currency, total]) => (
                <tr key={currency}>
                  <td colSpan={3}><strong>{currency} totals</strong></td>
                  <td className="numeric">{formatMinor(total.debit, currency)}</td>
                  <td className="numeric">{formatMinor(total.credit, currency)}</td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      </section>
    </main>
  );
}
