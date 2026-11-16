import Link from "next/link";

import { buildReportPageHref } from "@/modules/reports/domain/report-pagination";

export type ReportTableTab = Readonly<{
  id: string;
  label: string;
  count?: number;
}>;

/** URL tabs for multi-table report pages (`?tab=`). Resets to page 1 when switching. */
export function ReportTableTabs({
  pathname,
  tabs,
  active,
  query,
}: {
  pathname: string;
  tabs: readonly ReportTableTab[];
  active: string;
  query: Record<string, string | number | null | undefined>;
}) {
  return (
    <nav className="client-tabs" aria-label="Report sections">
      {tabs.map((tab) => {
        const href = buildReportPageHref(
          pathname,
          { ...query, tab: tab.id, page: undefined },
          1,
        );
        const label =
          tab.count === undefined ? tab.label : `${tab.label} (${tab.count.toLocaleString()})`;
        return (
          <Link key={tab.id} className={active === tab.id ? "active" : undefined} href={href}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function parseReportTab(value: string | undefined, allowed: readonly string[], fallback: string) {
  if (value && allowed.includes(value)) return value;
  return fallback;
}
