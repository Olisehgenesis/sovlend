"use client";

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

  return (
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
