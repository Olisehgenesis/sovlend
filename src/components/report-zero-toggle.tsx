"use client";

/**
 * Switch-styled checkbox for report filter forms: "show zero-balance / zero-activity
 * rows". Auto-submits the enclosing GET form on change so the toggle takes effect
 * immediately, without needing a separate "Apply filters" click.
 */
export function ReportZeroToggle({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="report-toggle">
      <input
        defaultChecked={defaultChecked}
        name={name}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        type="checkbox"
        value="1"
      />
      <span className="report-toggle-track">
        <span className="report-toggle-thumb" />
      </span>
      <span className="report-toggle-label">{label}</span>
    </label>
  );
}
