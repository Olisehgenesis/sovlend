"use client";

import { FileSpreadsheet, FileText } from "lucide-react";
import { useRouter } from "next/navigation";

export type ReportPickerOption = Readonly<{
  href: string;
  title: string;
  sectionTitle: string;
}>;

/**
 * Grouped "jump to report" dropdown shown at the top of every report page,
 * mirroring iLend's Reports > category > report navigation so operators can
 * move between reports without going back to the directory each time.
 */
export function ReportPicker({ options, current }: { options: readonly ReportPickerOption[]; current: string }) {
  const router = useRouter();
  const sections = groupBySection(options);
  const currentReport = options.find((option) => option.href === current);
  const canExport = Boolean(currentReport && current !== "/reports/client-statement");

  function csvHref() {
    const params = new URLSearchParams(window.location.search);
    params.set("format", "csv");
    return `/api${current}?${params.toString()}`;
  }

  function downloadExcel() {
    // Direct file download — do not pull the xlsx library over the branch network.
    // Excel opens this CSV; amounts are already in shillings.
    window.location.assign(csvHref());
  }

  function downloadPdf() {
    window.print();
  }

  return (
    <div className="report-picker-tools">
      <label className="report-picker">
        <span>Jump to report</span>
        <select
          value={current}
          onChange={(event) => {
            const href = event.target.value;
            if (href) router.push(href);
          }}
        >
          <option value="">Choose a report…</option>
          {sections.map(([sectionTitle, sectionOptions]) => (
            <optgroup key={sectionTitle} label={sectionTitle}>
              {sectionOptions.map((option) => (
                <option key={option.href} value={option.href}>
                  {option.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {canExport ? (
        <div className="report-export-actions">
          <button className="secondary-action" onClick={downloadExcel} type="button">
            <FileSpreadsheet size={15} />
            Excel
          </button>
          <button className="secondary-action" onClick={downloadPdf} type="button">
            <FileText size={15} />
            Print / PDF
          </button>
        </div>
      ) : null}
    </div>
  );
}

function groupBySection(options: readonly ReportPickerOption[]) {
  const bySection = new Map<string, ReportPickerOption[]>();
  for (const option of options) {
    const list = bySection.get(option.sectionTitle) ?? [];
    list.push(option);
    bySection.set(option.sectionTitle, list);
  }
  return Array.from(bySection.entries());
}
