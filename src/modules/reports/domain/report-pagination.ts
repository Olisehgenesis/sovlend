export const DEFAULT_REPORT_PAGE_SIZE = 50;

export type ReportPagination = Readonly<{
  page: number;
  pageSize: number;
}>;

export type ReportPageResult<T> = Readonly<{
  items: T[];
  totalRows: number;
  totalPages: number;
  page: number;
  pageSize: number;
}>;

type SearchParamSource = {
  get?: (key: string) => string | null;
  [key: string]: unknown;
};

function readParam(source: SearchParamSource | null | undefined, key: string): string | undefined {
  if (!source) return undefined;
  if (typeof source.get === "function") {
    return source.get(key) ?? undefined;
  }
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

/** Parse `page` / `pageSize` from URL search params. Default page size 50 (max 100). */
export function parseReportPagination(
  source: SearchParamSource | null | undefined,
  defaults: { pageSize?: number } = {},
): ReportPagination {
  const defaultSize = defaults.pageSize ?? DEFAULT_REPORT_PAGE_SIZE;
  const pageRaw = Number.parseInt(readParam(source, "page") ?? "1", 10);
  const sizeRaw = Number.parseInt(readParam(source, "pageSize") ?? String(defaultSize), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const pageSize = Math.min(100, Math.max(10, Number.isFinite(sizeRaw) && sizeRaw > 0 ? sizeRaw : defaultSize));
  return { page, pageSize };
}

export function paginateItems<T>(items: readonly T[], pagination: ReportPagination): ReportPageResult<T> {
  const totalRows = items.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pagination.pageSize));
  const page = Math.min(pagination.page, totalPages);
  const start = (page - 1) * pagination.pageSize;
  return {
    items: items.slice(start, start + pagination.pageSize),
    totalRows,
    totalPages,
    page,
    pageSize: pagination.pageSize,
  };
}

export function reportPageSkip(pagination: ReportPagination) {
  return (Math.max(1, pagination.page) - 1) * pagination.pageSize;
}

export function reportTotalPages(totalRows: number, pageSize: number) {
  return Math.max(1, Math.ceil(totalRows / pageSize));
}

/** Build a report URL preserving filters, swapping `page` (and optional `tab`). */
export function buildReportPageHref(
  pathname: string,
  query: Record<string, string | number | null | undefined>,
  page: number,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") continue;
    if (key === "page") continue;
    params.set(key, String(value));
  }
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `${pathname}?${suffix}` : pathname;
}
