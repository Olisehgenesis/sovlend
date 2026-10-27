import { buildReportQueryString } from "@/modules/reports/domain/accounting-report";

export function journalSearchHref(values: {
  startDate?: string | null;
  endDate?: string | null;
  officeId?: string | null;
  accountId?: string | null;
  entrySource?: string | null;
  search?: string | null;
  minAmount?: string | null;
  maxAmount?: string | null;
  preset?: string | null;
  journalId?: string | null;
  from?: string | null;
}) {
  const query = buildReportQueryString(values);
  return `/reports/accounting/journal-reconciliation${query ? `?${query}` : ""}`;
}
