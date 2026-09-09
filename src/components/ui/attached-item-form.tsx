"use client";

import { LoaderCircle, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { BrandActionButton } from "@/components/ui/brand-action-button";

/**
 * Shared "add item" form chrome for the loan-detail attached-items panels (charges,
 * collateral, and similar future item types) — `<fieldset>`/`<legend>`/`form-row` grid/
 * submit-button-with-spinner markup was hand-copied between loan-charge-panel and
 * loan-collateral-panel. The actual submit handler (fetch call, success/error toasts)
 * stays owned by each panel since that's business logic, not markup.
 */
export type AttachedItemFormField =
  | {
      type: "text" | "number" | "date";
      name: string;
      label: string;
      placeholder?: string;
      required?: boolean;
      min?: number;
      step?: string;
      defaultValue?: string;
    }
  | {
      type: "select";
      name: string;
      label: string;
      options: readonly string[];
      defaultValue?: string;
    };

export function AttachedItemForm({
  legend,
  fieldRows,
  action,
  pending,
  submitLabel,
}: {
  legend: string;
  fieldRows: ReadonlyArray<ReadonlyArray<AttachedItemFormField>>;
  action: (formData: FormData) => void | Promise<void>;
  pending: boolean;
  submitLabel: string;
}) {
  return (
    <form action={action} className="entity-form compact-mapping">
      <fieldset>
        <legend>{legend}</legend>
        {fieldRows.map((fields, rowIndex) => (
          <div className={fields.length > 2 ? "form-row three" : "form-row"} key={rowIndex}>
            {fields.map((field) => (
              <label key={field.name}>
                {field.label}
                {renderField(field)}
              </label>
            ))}
          </div>
        ))}
      </fieldset>
      <div className="form-actions">
        <BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} type="submit">
          {submitLabel}
        </BrandActionButton>
      </div>
    </form>
  );
}

function renderField(field: AttachedItemFormField): ReactNode {
  if (field.type === "select") {
    return (
      <select defaultValue={field.defaultValue} name={field.name}>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      defaultValue={field.defaultValue}
      min={field.min}
      name={field.name}
      placeholder={field.placeholder}
      required={field.required}
      step={field.step}
      type={field.type}
    />
  );
}
