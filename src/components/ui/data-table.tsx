import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared table primitive for list/report pages.
 *
 * Consolidates the two hand-rolled `<table>` patterns that used to be reimplemented per page:
 * - Clickable entity rows (`<table className="clickable-rows">` + an absolutely-positioned
 *   `.row-link` in the first cell) as seen on clients/groups/loan-applications list pages.
 * - Report tables with an optional `<tfoot>` totals row.
 *
 * This does not attempt a full report shell (filters/export scaffolding); it only owns the
 * `<table>` markup itself so pages keep their own data loading, filters, and CSV export links.
 */
export type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  headerClassName?: string;
  cellClassName?: string;
};

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  rowHref,
  getRowAriaLabel,
  footer,
  emptyState,
  tableClassName,
}: {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: readonly T[];
  getRowKey: (row: T) => string;
  /** When provided, rows render as a full-row link (the `clickable-rows` pattern). */
  rowHref?: (row: T) => string | null | undefined;
  getRowAriaLabel?: (row: T) => string;
  footer?: ReactNode;
  emptyState?: ReactNode;
  tableClassName?: string;
}) {
  if (rows.length === 0) {
    return emptyState ? <>{emptyState}</> : null;
  }

  const classes = [rowHref ? "clickable-rows" : null, tableClassName].filter(Boolean).join(" ");

  return (
    <div className="table-scroll">
      <table className={classes || undefined}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th className={column.headerClassName} key={column.key}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row);
            return (
              <tr key={getRowKey(row)}>
                {columns.map((column, index) => (
                  <td className={column.cellClassName} key={column.key}>
                    {column.render(row)}
                    {index === 0 && href ? (
                      <Link aria-label={getRowAriaLabel?.(row) ?? "Open"} className="row-link" href={href} />
                    ) : null}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  );
}
