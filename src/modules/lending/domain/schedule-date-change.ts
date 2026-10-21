export class ScheduleDateChangeError extends Error {}

export type ScheduleDateRow = Readonly<{
  id: string;
  installmentNumber: number;
  dueOn: Date;
  outstandingMinor: bigint;
  penaltyAssessedOn: Date | null;
  interestAccruedOn: Date | null;
  hasActivePayment: boolean;
}>;

export type ScheduleDateChange = Readonly<{
  id: string;
  installmentNumber: number;
  from: Date;
  to: Date;
}>;

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function utcWeekdayName(day: string): string {
  return WEEKDAYS[parseUtcDay(day).getUTCDay()];
}

/** Place a due date on the chosen weekday inside the same Monday–Sunday week. */
export function moveUtcDayToWeekday(day: string, weekday: number): string {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new ScheduleDateChangeError("Choose a weekday");
  const date = parseUtcDay(day);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const moved = new Date(date);
  moved.setUTCDate(date.getUTCDate() - mondayOffset + ((weekday + 6) % 7));
  return utcDay(moved);
}

export function shiftUtcDay(day: string, days: number): string {
  if (!Number.isInteger(days) || days === 0 || Math.abs(days) > 366) throw new ScheduleDateChangeError("Enter a shift of 1 to 366 days");
  const date = parseUtcDay(day);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDay(date);
}

export function parseUtcDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ScheduleDateChangeError("Enter a valid due date");
  const [year, month, day] = value.split("-").map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (utcDay(date) !== value) throw new ScheduleDateChangeError("Enter a valid due date");
  return date;
}

/** Why a due date stays fixed. Null means the installment can move. */
export function scheduleDateLockReason(row: Pick<ScheduleDateRow, "outstandingMinor" | "penaltyAssessedOn" | "interestAccruedOn" | "hasActivePayment">): string | null {
  if (row.penaltyAssessedOn) return "Penalty already assessed";
  if (row.interestAccruedOn) return "Interest already accrued";
  if (row.hasActivePayment) return "Payment already recorded";
  if (row.outstandingMinor <= 0n) return "Settled";
  return null;
}

export function planScheduleDateChange(input: {
  disbursedOn: Date;
  installments: readonly ScheduleDateRow[];
  proposed: readonly { id: string; dueOn: string }[];
}): { changes: ScheduleDateChange[]; maturesOn: Date } {
  if (input.installments.length === 0) throw new ScheduleDateChangeError("This loan has no repayment schedule");
  const seen = new Set<string>();
  for (const item of input.proposed) {
    if (seen.has(item.id)) throw new ScheduleDateChangeError("Each installment can only be listed once");
    seen.add(item.id);
  }

  const proposedById = new Map(input.proposed.map((item) => [item.id, parseUtcDay(item.dueOn)]));
  const ordered = [...input.installments].sort((left, right) => left.installmentNumber - right.installmentNumber);
  const disbursed = utcDay(input.disbursedOn);
  const changes: ScheduleDateChange[] = [];
  const days: string[] = [];

  for (const row of ordered) {
    const next = proposedById.get(row.id) ?? row.dueOn;
    const lock = scheduleDateLockReason(row);
    if (lock && utcDay(next) !== utcDay(row.dueOn)) {
      throw new ScheduleDateChangeError(`Installment ${row.installmentNumber} cannot move. ${lock}`);
    }
    const day = utcDay(next);
    if (day <= disbursed) throw new ScheduleDateChangeError(`Installment ${row.installmentNumber} must be after the disbursement date`);
    if (days.length > 0 && day <= days[days.length - 1]) {
      throw new ScheduleDateChangeError(day === days[days.length - 1] ? "Two installments cannot fall on the same day" : "Repayment dates must stay in installment order");
    }
    days.push(day);
    if (day !== utcDay(row.dueOn)) {
      changes.push({ id: row.id, installmentNumber: row.installmentNumber, from: row.dueOn, to: next });
    }
  }

  for (const item of input.proposed) {
    if (!ordered.some((row) => row.id === item.id)) throw new ScheduleDateChangeError("Unknown installment");
  }
  if (changes.length === 0) throw new ScheduleDateChangeError("No repayment dates changed");

  const maturesOn = proposedById.get(ordered[ordered.length - 1].id) ?? ordered[ordered.length - 1].dueOn;
  return { changes, maturesOn };
}
