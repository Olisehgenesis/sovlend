"use client";

import { FileSpreadsheet, FileText, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

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
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);
  const currentReport = options.find((option) => option.href === current);
  const canExport = Boolean(currentReport && current !== "/reports/client-statement");

  async function loadCsvRows() {
    const params = new URLSearchParams(window.location.search);
    params.set("format", "csv");
    const response = await fetch(`/api${current}?${params.toString()}`);
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Report export failed");
    }
    return parseCsv(await response.text());
  }

  async function downloadExcel() {
    setExporting("excel");
    try {
      const [rows, XLSX] = await Promise.all([loadCsvRows(), import("xlsx")]);
      if (rows.length === 0) throw new Error("This report has no data to export");

      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      worksheet["!cols"] = rows[0].map((_, columnIndex) => ({
        wch: Math.min(48, Math.max(12, ...rows.map((row) => (row[columnIndex] ?? "").length))),
      }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(currentReport?.title ?? "Report"));
      XLSX.writeFile(workbook, `${exportBaseName(current)}.xlsx`);
      toast.success("Excel report downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download Excel report");
    } finally {
      setExporting(null);
    }
  }

  async function downloadPdf() {
    setExporting("pdf");
    try {
      const [rows, { jsPDF }, { default: autoTable }] = await Promise.all([
        loadCsvRows(),
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      if (rows.length === 0) throw new Error("This report has no data to export");

      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const title = currentReport?.title ?? "Report";
      doc.setFontSize(14);
      doc.text(title, 12, 12);
      doc.setFontSize(8);
      doc.text(`Generated ${new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(new Date())}`, 12, 18);
      autoTable(doc, {
        head: [rows[0]],
        body: rows.slice(1),
        startY: 22,
        theme: "grid",
        styles: { fontSize: 6, cellPadding: 1.4, overflow: "linebreak" },
        headStyles: { fillColor: [31, 90, 63] },
        horizontalPageBreak: true,
        horizontalPageBreakRepeat: [0],
      });
      doc.save(`${exportBaseName(current)}.pdf`);
      toast.success("PDF report downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download PDF report");
    } finally {
      setExporting(null);
    }
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
          <button className="secondary-action" disabled={exporting !== null} onClick={downloadExcel} type="button">
            {exporting === "excel" ? <LoaderCircle className="spin" size={15} /> : <FileSpreadsheet size={15} />}
            Excel
          </button>
          <button className="secondary-action" disabled={exporting !== null} onClick={downloadPdf} type="button">
            {exporting === "pdf" ? <LoaderCircle className="spin" size={15} /> : <FileText size={15} />}
            PDF
          </button>
        </div>
      ) : null}
    </div>
  );
}

function parseCsv(value: string): string[][] {
  const input = value.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => item !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.some((item) => item !== "")) rows.push(row);
  }
  return rows;
}

function exportBaseName(path: string) {
  return `sovlend-${path.split("/").filter(Boolean).at(-1) ?? "report"}-${new Date().toISOString().slice(0, 10)}`;
}

function safeSheetName(value: string) {
  return value.replace(/[\\/?*:[\]]/g, " ").slice(0, 31) || "Report";
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
