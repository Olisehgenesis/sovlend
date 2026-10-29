import { BookOpenText, Download } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportPicker } from "@/components/report-picker";
import { SearchableSelect } from "@/components/searchable-select";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";
import {
  accountingAccountTypeSections,
  buildReportQueryString,
  currentMonthDateRange,
  formatDateInputValue,
  formatReportDate,
  getGeneralLedgerReport,
  listAccountingReportAccounts,
  listAccountingReportOffices,
  normalizeDateRange,
  parseDateInput,
  resolveAccountTypeFilter,
  resolveDatePreset,
  resolveLedgerAccountInclude,
  resolveOfficeFilter,
  sideLabel,
  summarizeBalance,
  type GeneralLedgerAccountBalance,
  type GeneralLedgerEntry,
  type ReportDatePreset,
} from "@/modules/reports/domain/accounting-report";

const DATE_PRESETS: { value: ReportDatePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
];

export default async function GeneralLedgerView({
  searchParams,
  selectedAccountId,
}: {
  searchParams: Promise<{
    startDate?: string;
    endDate?: string;
    officeId?: string;
    preset?: string;
    accountId?: string;
    fromCode?: string;
    toCode?: string;
    accountType?: string;
    include?: string;
  }>;
  selectedAccountId?: string;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportGeneralLedger,
  );
  if (!allowed) redirect("/reports");

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
  const accountId = selectedAccountId || params.accountId || null;
  const accountType = resolveAccountTypeFilter(params.accountType ?? null);
  const include = resolveLedgerAccountInclude(params.include);
  const fromCode = params.fromCode?.trim() || null;
  const toCode = params.toCode?.trim() || null;
  if (accountId && !accounts.some((account) => account.id === accountId)) notFound();
  if (params.officeId && !officeId) notFound();
  const report = await getGeneralLedgerReport(prisma, scope, {
    startDate,
    endDate,
    officeId,
    accountId,
    fromCode,
    toCode,
    accountType,
    include,
  });
  const activeOfficeName = offices.find((office) => office.id === officeId)?.name ?? "All offices";
  const queryString = buildReportQueryString({
    startDate: formatDateInputValue(startDate),
    endDate: formatDateInputValue(endDate),
    officeId,
    accountId,
    fromCode,
    toCode,
    accountType,
    include: include === "balance" ? null : include,
  });
  const basePath = selectedAccountId ? `/reports/accounting/general-ledger/accounts/${selectedAccountId}` : "/reports/accounting/general-ledger";
  const accountHref = (id: string) => `/reports/accounting/general-ledger/accounts/${id}?${buildReportQueryString({
    startDate: formatDateInputValue(startDate), endDate: formatDateInputValue(endDate), officeId,
  })}`;
  const apiHref = `/api/reports/accounting/general-ledger${queryString ? `?${queryString}` : ""}`;
  const exportHref = `${apiHref}${queryString ? "&" : "?"}format=csv`;
  const isBalanced = report.debitTotalMinor === report.creditTotalMinor;

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Reports", href: "/reports" }, { label: "General Ledger", href: report.account ? "/reports/accounting/general-ledger" : undefined }, ...(report.account ? [{ label: report.account.name }] : [])]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Accounting statements</p>
          <h1>{report.account?.name ?? "General Ledger"}</h1>
          <p>
            {report.account ? `${report.account.code} · ${report.account.type}` : "One section per account"} · movements from {formatReportDate(report.startDate)} to {formatReportDate(report.endDate)} · {activeOfficeName}
          </p>
        </div>
        <ReportPicker current="/reports/accounting/general-ledger" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
          {report.account ? (
            <Link className="secondary-action" href={`/reports/accounting/general-ledger?${buildReportQueryString({ startDate: formatDateInputValue(startDate), endDate: formatDateInputValue(endDate), officeId })}`}>
              All accounts
            </Link>
          ) : null}
        </div>
      </header>

      <section className="panel form-panel">
        <div className="quick-filters">
          <span className="quick-filters-label">Quick range</span>
          <div className="quick-filters-pills">
            {DATE_PRESETS.map((item) => (
              <Link
                className={`pill-link ${preset === item.value ? "active" : ""}`}
                href={`${basePath}?${buildReportQueryString({ preset: item.value, officeId, accountId, fromCode, toCode, accountType, include: include === "balance" ? null : include })}`}
                key={item.value}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
        <form action="/reports/accounting/general-ledger" className="entity-form compact-mapping" method="GET">
          <fieldset>
            <legend>Filters</legend>
            <div className="form-row three">
              <label>
                Start date
                <input defaultValue={formatDateInputValue(startDate)} name="startDate" required type="date" />
              </label>
              <label>
                End date
                <input defaultValue={formatDateInputValue(endDate)} name="endDate" required type="date" />
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
              GL account
              <SearchableSelect
                key={accountId ?? "all"}
                name="accountId"
                defaultValue={accountId ?? ""}
                placeholder="Search account by name or code..."
                options={[{ value: "", label: "All accounts" }, ...accounts.map((account) => ({
                  value: account.id, label: `${account.code} · ${account.name}`, searchText: account.type,
                }))]}
              />
            </label>
            <div className="form-row three">
              <label>
                From account code
                <input defaultValue={fromCode ?? ""} name="fromCode" placeholder="CA-001" />
              </label>
              <label>
                To account code
                <input defaultValue={toCode ?? ""} name="toCode" placeholder="CA-003" />
              </label>
              <label>
                Account type
                <select defaultValue={accountType ?? ""} name="accountType">
                  <option value="">All types</option>
                  {accountingAccountTypeSections.map((section) => (
                    <option key={section.type} value={section.type}>
                      {section.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Accounts to print
              <select defaultValue={include} name="include">
                <option value="movement">Only accounts with movement this period</option>
                <option value="balance">Accounts with a balance or movement</option>
                <option value="all">Every account</option>
              </select>
            </label>
          </fieldset>
          <div className="form-actions">
            <button className="invest-button" type="submit">
              Apply filters
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{report.account ? "Account register" : "General ledger by account"}</h2>
            <p>
              {report.journalCount.toLocaleString()} posted journal{report.journalCount === 1 ? "" : "s"} · {report.lineCount.toLocaleString()} ledger line
              {report.lineCount === 1 ? "" : "s"}
            </p>
          </div>
          {!report.account ? <span className={`status ${isBalanced ? "up-to-date" : "review"}`}>
            {isBalanced ? "Debits equal credits" : "Debit/credit difference"} ·{" "}
            {formatMinor(report.debitTotalMinor - report.creditTotalMinor, "UGX")}
          </span> : null}
        </div>

        {report.accountBalances.length === 0 ? (
          <div className="empty-state">
            <BookOpenText size={28} />
            <strong>No posted entries in this period</strong>
            <p>Try a wider date range, a different office, or include accounts that still have a balance.</p>
          </div>
        ) : (
          report.accountBalances.map((balance) => (
            <LedgerAccountSection
              accountHref={accountHref(balance.account.id)}
              balance={balance}
              entries={report.entries.filter((entry) => entry.account.id === balance.account.id)}
              key={balance.account.id}
              queryString={queryString}
            />
          ))
        )}
      </section>
    </main>
  );
}

function LedgerAccountSection({
  accountHref,
  balance,
  entries,
  queryString,
}: {
  accountHref: string;
  balance: GeneralLedgerAccountBalance;
  entries: GeneralLedgerEntry[];
  queryString: string;
}) {
  const opening = summarizeBalance(balance.account.type, balance.openingBalanceMinor);
  const closing = summarizeBalance(balance.account.type, balance.closingBalanceMinor);
  return (
    <div className="ledger-account-block">
      <div className="ledger-account-heading">
        <div>
          <h3>
            <Link className="green-link" href={accountHref}>
              {balance.account.code} · {balance.account.name}
            </Link>
          </h3>
          <p className="ledger-account-meta">{balance.account.type} · {balance.account.currencyCode}</p>
        </div>
        <div className="ledger-balance-strip">
          <div>
            <span>Opening</span>
            <strong>{formatMinor(opening.absoluteMinor, balance.account.currencyCode)} {sideLabel(opening.balanceSide)}</strong>
          </div>
          <div>
            <span>Debits</span>
            <strong>{formatMinor(balance.debitTotalMinor, balance.account.currencyCode)}</strong>
          </div>
          <div>
            <span>Credits</span>
            <strong>{formatMinor(balance.creditTotalMinor, balance.account.currencyCode)}</strong>
          </div>
          <div>
            <span>Closing</span>
            <strong>{formatMinor(closing.absoluteMinor, balance.account.currencyCode)} {sideLabel(closing.balanceSide)}</strong>
          </div>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Vendor / client</th>
              <th>Journal</th>
              <th>Office</th>
              <th>Memo</th>
              <th className="numeric">Debit</th>
              <th className="numeric">Credit</th>
              <th className="numeric">Running balance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5}><strong>Opening balance</strong></td>
              <td className="numeric">—</td>
              <td className="numeric">—</td>
              <td className="numeric">
                {formatMinor(opening.absoluteMinor, balance.account.currencyCode)} {sideLabel(opening.balanceSide)}
              </td>
            </tr>
            {entries.map((entry) => {
              const running = summarizeBalance(entry.account.type, entry.runningBalanceMinor);
              const journalHref = `/reports/accounting/general-ledger/entries/${entry.journalId}?${queryString}`;
              return (
                <tr key={entry.id}>
                  <td>
                    <Link className="green-link" href={journalHref}>{formatReportDate(entry.businessDate)}</Link>
                  </td>
                  <td>
                    {entry.payeeName ?? "—"}
                    {entry.payeeReference ? <small>{entry.payeeReference}</small> : null}
                  </td>
                  <td>
                    <Link className="green-link" href={journalHref}>View entry</Link>
                    <small>{entry.referenceType.replaceAll("_", " ")}</small>
                  </td>
                  <td>{entry.officeName}</td>
                  <td>{entry.memo ?? entry.narration}</td>
                  <td className="numeric">{entry.direction === "DEBIT" ? formatMinor(entry.amountMinor, entry.account.currencyCode) : "—"}</td>
                  <td className="numeric">{entry.direction === "CREDIT" ? formatMinor(entry.amountMinor, entry.account.currencyCode) : "—"}</td>
                  <td className="numeric">
                    {`${formatMinor(running.absoluteMinor, entry.account.currencyCode)} ${sideLabel(running.balanceSide)}`}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={5}><strong>Closing balance</strong></td>
              <td className="numeric"><strong>{formatMinor(balance.debitTotalMinor, balance.account.currencyCode)}</strong></td>
              <td className="numeric"><strong>{formatMinor(balance.creditTotalMinor, balance.account.currencyCode)}</strong></td>
              <td className="numeric">
                <strong>
                  {formatMinor(closing.absoluteMinor, balance.account.currencyCode)} {sideLabel(closing.balanceSide)}
                </strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
