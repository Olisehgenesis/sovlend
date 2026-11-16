import Link from "next/link";

import { buildReportQueryString, type ReportDatePreset } from "@/modules/reports/domain/accounting-report";

export const REPORT_DATE_PRESETS: { value: ReportDatePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
];

export function parseReportDatePreset(value?: string | null): ReportDatePreset | null {
  if (value === "today" || value === "week" || value === "month" || value === "year") return value;
  return null;
}

/** Quick-range pills for report toolbars. Extra query keys (officeId, showZero, …) stay on the link. */
export function ReportDatePresetPills({
  pathname,
  active,
  query = {},
  label = "Range",
}: {
  pathname: string;
  active: ReportDatePreset | null;
  query?: Record<string, string | null | undefined>;
  label?: string;
}) {
  return (
    <div className="quick-filters report-toolbar-presets">
      <span className="quick-filters-label">{label}</span>
      <div className="quick-filters-pills">
        {REPORT_DATE_PRESETS.map((item) => (
          <Link
            className={`pill-link ${active === item.value ? "active" : ""}`}
            href={`${pathname}?${buildReportQueryString({ ...query, preset: item.value })}`}
            key={item.value}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
