"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";
import { moveUtcDayToWeekday, shiftUtcDay, utcWeekdayName, WEEKDAYS } from "@/modules/lending/domain/schedule-date-change";

type RescheduleRow = {
  id: string;
  installmentNumber: number;
  dueOn: string;
  lockReason: string | null;
};

function sequenceProblem(rows: RescheduleRow[], dates: Record<string, string>): string | null {
  let previous = "";
  for (const row of rows) {
    const day = dates[row.id] ?? row.dueOn;
    if (previous && day <= previous) {
      return day === previous
        ? "Two installments cannot fall on the same day"
        : "Repayment dates must stay in installment order";
    }
    previous = day;
  }
  return null;
}

export function RescheduleLoanForm({ loanId, updatedAt, rows }: {
  loanId: string;
  updatedAt: string;
  rows: RescheduleRow[];
}) {
  const router = useRouter();
  const [dates, setDates] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((row) => [row.id, row.dueOn])));
  const [selected, setSelected] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((row) => [row.id, !row.lockReason])));
  const [weekday, setWeekday] = useState("5");
  const [shiftDays, setShiftDays] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const editable = rows.some((row) => !row.lockReason);
  const openRows = rows.filter((row) => !row.lockReason);
  const allOpenSelected = openRows.length > 0 && openRows.every((row) => selected[row.id]);
  const changed = rows.some((row) => !row.lockReason && dates[row.id] !== row.dueOn);
  const orderProblem = useMemo(() => sequenceProblem(rows, dates), [rows, dates]);

  function applyToSelected(nextDay: (current: string) => string) {
    const targets = rows.filter((row) => !row.lockReason && selected[row.id]);
    if (targets.length === 0) {
      toast.error("Select at least one open installment");
      return;
    }
    setDates((current) => {
      const next = { ...current };
      for (const row of targets) next[row.id] = nextDay(current[row.id] ?? row.dueOn);
      return next;
    });
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changed || orderProblem) return;
    setPending(true);
    try {
      const response = await fetch(`/api/loans/${loanId}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          expectedUpdatedAt: updatedAt,
          dates: rows.map((row) => ({ id: row.id, dueOn: dates[row.id] ?? row.dueOn })),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        toast.error(result.error ?? "Could not change the repayment dates");
        return;
      }
      toast.success("Repayment dates saved. Maturity and arrears now follow the new schedule.");
      setReason("");
      router.refresh();
    } catch {
      toast.error("Could not change the repayment dates. Refresh before retrying.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Change due dates</h2>
          <p>Put open installments on the day you want. Move every selected date onto one weekday, such as Friday, shift the selected dates together, or set a single date on its own row.</p>
        </div>
      </div>
      <form className="entity-form" onSubmit={save}>
        <fieldset disabled={pending}>
          {editable ? (
            <div className="schedule-date-tools">
              <label>
                Weekday
                <select aria-label="Weekday for selected installments" value={weekday} onChange={(event) => setWeekday(event.target.value)}>
                  {WEEKDAYS.map((name, index) => <option key={name} value={index}>{name}</option>)}
                </select>
              </label>
              <button
                className="secondary-action"
                type="button"
                onClick={() => applyToSelected((day) => moveUtcDayToWeekday(day, Number(weekday)))}
              >
                Move selected to {WEEKDAYS[Number(weekday)]}
              </button>
              <label>
                Shift by days
                <input
                  type="number"
                  inputMode="numeric"
                  min={-366}
                  max={366}
                  step={1}
                  placeholder="7"
                  aria-label="Days to shift selected installments"
                  value={shiftDays}
                  onChange={(event) => setShiftDays(event.target.value)}
                />
              </label>
              <button
                className="secondary-action"
                type="button"
                onClick={() => {
                  const days = Number(shiftDays);
                  if (!Number.isInteger(days) || days === 0) {
                    toast.error("Enter a number of days, other than zero");
                    return;
                  }
                  try {
                    applyToSelected((day) => shiftUtcDay(day, days));
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Could not shift those dates");
                  }
                }}
              >
                Shift selected
              </button>
            </div>
          ) : null}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Select all open installments"
                      checked={allOpenSelected}
                      disabled={!editable}
                      onChange={(event) => setSelected(Object.fromEntries(rows.map((row) => [row.id, !row.lockReason && event.target.checked])))}
                    />
                  </th>
                  <th className="row-index">#</th>
                  <th>Current due</th>
                  <th>New due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const next = dates[row.id] ?? row.dueOn;
                  return (
                    <tr key={row.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select installment ${row.installmentNumber}`}
                          checked={Boolean(selected[row.id])}
                          disabled={Boolean(row.lockReason)}
                          onChange={(event) => setSelected((current) => ({ ...current, [row.id]: event.target.checked }))}
                        />
                      </td>
                      <td className="row-index">{row.installmentNumber}</td>
                      <td>{row.dueOn} · {utcWeekdayName(row.dueOn)}</td>
                      <td>
                        <input
                          type="date"
                          aria-label={`Due date for installment ${row.installmentNumber}`}
                          disabled={Boolean(row.lockReason)}
                          required
                          value={next}
                          onChange={(event) => setDates((current) => ({ ...current, [row.id]: event.target.value }))}
                        />
                        {next !== row.dueOn ? <small>{utcWeekdayName(next)}</small> : null}
                      </td>
                      <td>{row.lockReason ?? "Can move"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {orderProblem ? <p role="alert">{orderProblem}</p> : null}
          {editable ? (
            <label>
              Reason
              <textarea required minLength={3} maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
          ) : (
            <p>Every installment is settled, paid, or already assessed, so these dates stay as they are.</p>
          )}
        </fieldset>
        {editable ? (
          <div className="form-actions">
            <BrandActionButton type="submit" disabled={pending || !changed || Boolean(orderProblem) || reason.trim().length < 3}>
              {pending ? "Saving..." : "Save due dates"}
            </BrandActionButton>
          </div>
        ) : null}
      </form>
    </section>
  );
}
