import { BookOpenText, Download } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { LiveSearchInput } from "@/components/live-search-input";
import { ReportPicker } from "@/components/report-picker";
import { journalSearchHref } from "@/lib/journal-search-href";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";
import {
  accountTypeLabel,
  buildReportQueryString,
  currentMonthDateRange,
  formatDateInputValue,
  formatReportDate,
  getGeneralLedgerReport,
  getJournalReconciliationReport,
  isManualJournalReferenceType,
  listAccountingReportAccounts,
  listAccountingReportOffices,
  minorToAmountInputValue,
  normalizeDateRange,
  parseAmountFilterMinor,
  parseDateInput,
  resolveAccountFilter,
  resolveDatePreset,
  resolveEntrySourceFilter,
  resolveOfficeFilter,
  sideLabel,
  summarizeBalance,
  type JournalReconciliationJournal,
  type ReportDatePreset,
} from "@/modules/reports/domain/accounting-report";

import { JournalAccountField } from "./_components/journal-account-field";
import { ScrollToPosted } from "./_components/scroll-to-posted";

const DATE_PRESETS: { value: ReportDatePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
];

function visibleLines(journal: JournalReconciliationJournal) {
  return journal.lines;
}

export default async function JournalReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{
    startDate?: string;
    endDate?: string;
    officeId?: string;
    accountId?: string;
    entrySource?: string;
    search?: string;
    minAmount?: string;
    maxAmount?: string;
    preset?: string;
    journalId?: string;
  }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const authorization = new AuthorizationService(prisma);
  const allowed = await authorization.isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportJournalReconciliation,
  );
  if (!allowed) redirect("/reports");
  const canReadLedger = await authorization.isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportGeneralLedger,
  );

  const params = await searchParams;
  const defaults = currentMonthDateRange();
  const [offices, accounts, pickerOptions] = await Promise.all([
    listAccountingReportOffices(prisma, scope),
    listAccountingReportAccounts(prisma),
    loadReportPickerOptions(prisma, session.user.id, scope.organizationId),
  ]);
  const preset = params.preset === "today" || params.preset === "week" || params.preset === "month" || params.preset === "year"
    ? params.preset
    : null;
  const { startDate, endDate } = preset
    ? resolveDatePreset(new Date(), preset)
    : normalizeDateRange(
        parseDateInput(params.startDate, defaults.startDate),
        parseDateInput(params.endDate, defaults.endDate),
      );
  const officeId = resolveOfficeFilter(offices, params.officeId ?? null);
  const accountId = resolveAccountFilter(accounts, params.accountId ?? null);
  const entrySource = resolveEntrySourceFilter(params.entrySource ?? null);
  const search = params.search?.trim() || null;
  const minAmountMinor = parseAmountFilterMinor(params.minAmount);
  const maxAmountMinor = parseAmountFilterMinor(params.maxAmount);
  const highlightedJournalId = z.uuid().safeParse(params.journalId).success ? params.journalId ?? null : null;
  const [report, ledger] = await Promise.all([
    getJournalReconciliationReport(prisma, scope, {
      startDate,
      endDate,
      officeId,
      accountId,
      entrySource,
      search,
      minAmountMinor,
      maxAmountMinor,
    }),
    canReadLedger && accountId
      ? getGeneralLedgerReport(prisma, scope, { startDate, endDate, officeId, accountId })
      : Promise.resolve(null),
  ]);
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;
  const activeOfficeName = offices.find((office) => office.id === officeId)?.name ?? "All offices";
  const startValue = formatDateInputValue(startDate);
  const endValue = formatDateInputValue(endDate);
  const minAmount = minAmountMinor === null ? null : minorToAmountInputValue(minAmountMinor);
  const maxAmount = maxAmountMinor === null ? null : minorToAmountInputValue(maxAmountMinor);
  const sourceValue = entrySource === "ALL" ? null : entrySource;
  const filterHref = (overrides: Parameters<typeof journalSearchHref>[0] = {}) => journalSearchHref({
    startDate: startValue,
    endDate: endValue,
    officeId,
    accountId,
    entrySource: sourceValue,
    search,
    minAmount,
    maxAmount,
    ...overrides,
  });
  const activePreset = DATE_PRESETS.find((item) => {
    const range = resolveDatePreset(new Date(), item.value);
    return formatDateInputValue(range.startDate) === startValue && formatDateInputValue(range.endDate) === endValue;
  })?.value ?? null;
  const accountOptions = [
    { value: "", label: "All accounts" },
    ...accounts.map((account) => ({
      value: account.id,
      label: `${account.code} · ${account.name}`,
      searchText: `${account.type} ${account.currencyCode}`,
    })),
  ];
  const accountBalance = ledger?.accountBalances.find((balance) => balance.account.id === accountId) ?? null;
  const rows = report.journals.flatMap((journal) => {
    const lines = visibleLines(journal);
    return lines.map((line, index) => ({
      line,
      journal,
      anchor: index === 0,
    }));
  }).sort((left, right) => {
    const dateCompare = left.journal.businessDate.getTime() - right.journal.businessDate.getTime();
    if (dateCompare !== 0) return dateCompare;
    return left.journal.id.localeCompare(right.journal.id);
  });
  const highlightedVisible = highlightedJournalId ? rows.some((row) => row.journal.id === highlightedJournalId) : false;
  const unbalanced = report.journals.filter((journal) => !journal.isBalanced);
  const extraFiltersOpen = entrySource !== "ALL" || minAmountMinor !== null || maxAmountMinor !== null;
  const chips = [
    selectedAccount ? { label: `${selectedAccount.code} · ${selectedAccount.name}`, href: filterHref({ accountId: null }) } : null,
    officeId ? { label: activeOfficeName, href: filterHref({ officeId: null }) } : null,
    entrySource === "MANUAL" ? { label: "Manual entries", href: filterHref({ entrySource: null }) } : null,
    entrySource === "SYSTEM" ? { label: "System entries", href: filterHref({ entrySource: null }) } : null,
    search ? { label: `“${search}”`, href: filterHref({ search: null }) } : null,
    minAmount ? { label: `At least ${minAmount}`, href: filterHref({ minAmount: null }) } : null,
    maxAmount ? { label: `At most ${maxAmount}`, href: filterHref({ maxAmount: null }) } : null,
  ].filter((chip): chip is { label: string; href: string } => chip !== null);
  const exportHref = `/api/reports/accounting/journal-reconciliation?${buildReportQueryString({
    startDate: startValue,
    endDate: endValue,
    officeId,
    accountId,
    entrySource: sourceValue,
    search,
    minAmount,
    maxAmount,
    format: "csv",
  })}`;
  const journalHref = (journalId: string) => `/reports/accounting/general-ledger/entries/${journalId}?${buildReportQueryString({
    startDate: startValue,
    endDate: endValue,
    officeId,
    accountId,
    search,
    entrySource: sourceValue,
    minAmount,
    maxAmount,
    from: "search",
  })}`;

  return (
    <main className="directory-page">
      <ScrollToPosted journalId={highlightedVisible ? highlightedJournalId : null} />
      <Breadcrumbs items={[{ label: "Reports", href: "/reports" }, { label: "Accounting", href: "/reports" }, { label: "Search journal entries" }]} />
      <header className="directory-header">
        <div>
          <h1>{selectedAccount ? selectedAccount.name : "Search journal entries"}</h1>
          <p>
            {selectedAccount ? `${selectedAccount.code} · ${accountTypeLabel(selectedAccount.type)} · ` : "All accounts · "}
            {formatReportDate(report.startDate)} to {formatReportDate(report.endDate)} · {activeOfficeName}
          </p>
        </div>
        <ReportPicker current="/reports/accounting/journal-reconciliation" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
        </div>
      </header>

      <section className="panel form-panel">
        <div className="quick-filters">
          <span className="quick-filters-label">Quick range</span>
          <div className="quick-filters-pills">
            {DATE_PRESETS.map((item) => (
              <Link
                className={`pill-link ${activePreset === item.value ? "active" : ""}`}
                href={filterHref({ preset: item.value, startDate: null, endDate: null })}
                key={item.value}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
        <form className="entity-form compact-mapping" method="GET">
          <LiveSearchInput paramName="search" placeholder="Search account, client, narration, or reference" />
          {search ? <input name="search" type="hidden" value={search} /> : null}
          <fieldset>
            <legend>From this date to this date</legend>
            <div className="form-row three">
              <label>
                Start date
                <input defaultValue={startValue} name="startDate" required type="date" />
              </label>
              <label>
                End date
                <input defaultValue={endValue} name="endDate" required type="date" />
              </label>
              <label>
                Office
                <select defaultValue={officeId ?? ""} name="officeId">
                  <option value="">All offices</option>
                  {offices.map((office) => (
                    <option key={office.id} value={office.id}>
                      {office.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Account
              <JournalAccountField defaultValue={accountId ?? ""} options={accountOptions} />
            </label>
            <details className="more-filters" {...(extraFiltersOpen ? { open: true } : {})}>
              <summary>More filters</summary>
              <div className="form-row three">
                <label>
                  Entry type
                  <select defaultValue={entrySource} name="entrySource">
                    <option value="ALL">All entries</option>
                    <option value="MANUAL">Manual entries only</option>
                    <option value="SYSTEM">System-generated only</option>
                  </select>
                </label>
                <label>
                  Min journal amount
                  <input defaultValue={minAmount ?? ""} inputMode="decimal" name="minAmount" pattern="[0-9]+([.][0-9]{1,2})?" placeholder="0.00" />
                </label>
                <label>
                  Max journal amount
                  <input defaultValue={maxAmount ?? ""} inputMode="decimal" name="maxAmount" pattern="[0-9]+([.][0-9]{1,2})?" placeholder="No limit" />
                </label>
              </div>
            </details>
          </fieldset>
          <div className="form-actions">
            <button className="primary" type="submit">
              Apply dates
            </button>
          </div>
        </form>
        {chips.length > 0 ? (
          <div className="journal-filter-chips">
            {chips.map((chip) => (
              <Link aria-label={`Remove ${chip.label}`} className="pill-link" href={chip.href} key={chip.label}>
                {chip.label} <span aria-hidden="true">×</span>
              </Link>
            ))}
            <Link className="pill-link" href={journalSearchHref({ startDate: startValue, endDate: endValue })}>
              Clear filters
            </Link>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{selectedAccount ? "Journals that touch this account" : "Journals"}</h2>
            <p>
              {rows.length.toLocaleString()} transaction{rows.length === 1 ? "" : "s"}
              {" · "}
              {report.journalCount.toLocaleString()} journal{report.journalCount === 1 ? "" : "s"}
            </p>
          </div>
          {unbalanced.length > 0 ? <span className="status review">Out of balance</span> : null}
        </div>

        {accountBalance ? (
          <div className="ledger-balance-strip">
            <div>
              <span>Opening</span>
              <strong>
                {formatMinor(summarizeBalance(accountBalance.account.type, accountBalance.openingBalanceMinor).absoluteMinor, accountBalance.account.currencyCode)}{" "}
                {sideLabel(summarizeBalance(accountBalance.account.type, accountBalance.openingBalanceMinor).balanceSide)}
              </strong>
            </div>
            <div>
              <span>Debits</span>
              <strong>{formatMinor(accountBalance.debitTotalMinor, accountBalance.account.currencyCode)}</strong>
            </div>
            <div>
              <span>Credits</span>
              <strong>{formatMinor(accountBalance.creditTotalMinor, accountBalance.account.currencyCode)}</strong>
            </div>
            <div>
              <span>Closing</span>
              <strong>
                {formatMinor(summarizeBalance(accountBalance.account.type, accountBalance.closingBalanceMinor).absoluteMinor, accountBalance.account.currencyCode)}{" "}
                {sideLabel(summarizeBalance(accountBalance.account.type, accountBalance.closingBalanceMinor).balanceSide)}
              </strong>
            </div>
          </div>
        ) : null}

        {highlightedJournalId && !highlightedVisible ? (
          <p className="journal-issue-note">
            The entry you just posted is outside this account or these dates.{" "}
            <Link className="green-link" href={`/reports/accounting/general-ledger/entries/${highlightedJournalId}?from=search`}>
              Open the entry
            </Link>
          </p>
        ) : null}

        {unbalanced.length > 0 ? (
          <p className="journal-issue-note">
            {unbalanced.length.toLocaleString()} journal{unbalanced.length === 1 ? "" : "s"} in this period {unbalanced.length === 1 ? "is" : "are"} out of balance.{" "}
            {unbalanced.slice(0, 3).map((journal, index) => (
              <span key={journal.id}>
                {index > 0 ? " · " : null}
                <Link className="green-link" href={journalHref(journal.id)}>
                  {formatReportDate(journal.businessDate)}
                </Link>
              </span>
            ))}
          </p>
        ) : null}

        {rows.length === 0 ? (
          <div className="empty-state">
            <BookOpenText size={28} />
            <strong>
              {search
                ? `Nothing matches “${search}”`
                : selectedAccount
                  ? `No transactions on ${selectedAccount.name}`
                  : "No transactions in these dates"}
            </strong>
            <p>
              {formatReportDate(report.startDate)} to {formatReportDate(report.endDate)}. Widen the dates, or clear a filter.
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Account</th>
                  <th>Description</th>
                  <th className="numeric">Debit</th>
                  <th className="numeric">Credit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ line, journal, anchor }) => {
                  return (
                    <tr className={journal.id === highlightedJournalId ? "posted-journal" : undefined} id={anchor ? `journal-${journal.id}` : undefined} key={line.lineId}>
                      <td>
                        <Link className="green-link" href={journalHref(journal.id)}>{formatReportDate(journal.businessDate)}</Link>
                        <small>View entry</small>
                        {officeId ? null : <small>{journal.officeName}</small>}
                      </td>
                      <td>
                        <Link className="green-link" href={filterHref({ accountId: line.id })}>{line.name}</Link>
                        <small>{line.code}</small>
                      </td>
                      <td>
                        {line.memo ?? journal.narration}
                        {journal.payeeName ? <small>{journal.payeeName}</small> : null}
                        <small>{isManualJournalReferenceType(journal.referenceType) ? "Manual" : journal.referenceType.replaceAll("_", " ")}</small>
                      </td>
                      <td className="numeric">{line.direction === "DEBIT" ? formatMinor(line.amountMinor, line.currencyCode) : "—"}</td>
                      <td className="numeric">{line.direction === "CREDIT" ? formatMinor(line.amountMinor, line.currencyCode) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
