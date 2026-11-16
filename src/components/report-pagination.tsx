import Link from "next/link";

import { buildReportPageHref } from "@/modules/reports/domain/report-pagination";

export function ReportPagination({
  pathname,
  query,
  page,
  totalPages,
  totalRows,
  pageSize,
  label = "Report pages",
}: {
  pathname: string;
  query: Record<string, string | number | null | undefined>;
  page: number;
  totalPages: number;
  totalRows: number;
  pageSize: number;
  label?: string;
}) {
  if (totalRows <= pageSize && totalPages <= 1) return null;

  const prev = Math.max(1, page - 1);
  const next = Math.min(totalPages, page + 1);
  const from = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalRows);

  return (
    <nav className="pagination" aria-label={label}>
      <Link aria-disabled={page <= 1} href={buildReportPageHref(pathname, query, prev)}>
        Previous
      </Link>
      <span>
        {from.toLocaleString()}–{to.toLocaleString()} of {totalRows.toLocaleString()} · page {page} of {totalPages}
      </span>
      <Link aria-disabled={page >= totalPages} href={buildReportPageHref(pathname, query, next)}>
        Next
      </Link>
    </nav>
  );
}
