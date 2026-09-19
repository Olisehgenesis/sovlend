/**
 * Single source of truth for computing an installment's or loan's true outstanding
 * balance. Mirrors Fineract's accounting identity: due = paid + waived + writtenOff + outstanding.
 *
 * Historically this codebase computed outstanding as `due - paid` everywhere, which is
 * correct for open loans but silently overstates the balance on WRITTEN_OFF loans: iLend
 * zeroes out a written-off loan's outstanding at the loan level (Loan.summary.*WrittenOff),
 * not by reducing individual installment rows. Always route outstanding calculations
 * through these helpers instead of re-deriving `due - paid` inline.
 */

export type InstallmentAmounts = {
  principalDueMinor: bigint;
  interestDueMinor: bigint;
  feesDueMinor: bigint;
  penaltiesDueMinor: bigint;
  principalPaidMinor: bigint;
  interestPaidMinor: bigint;
  feesPaidMinor: bigint;
  penaltiesPaidMinor: bigint;
  principalWaivedMinor?: bigint;
  interestWaivedMinor?: bigint;
  feesWaivedMinor?: bigint;
  penaltiesWaivedMinor?: bigint;
  // Monitoring fee is tracked in its own due/paid/waived columns going forward (see Problem 2 in
  // the accounting audit) so it can be posted to, and reported against, a distinct ledger income
  // account even when its rate coincides with the interest rate. Optional and defaulted to 0 so
  // every existing caller -- and every historical installment, which never populates these and
  // instead carries its monitoring fee inside feesDueMinor/feesPaidMinor -- keeps behaving
  // exactly as it does today.
  monitoringFeeDueMinor?: bigint;
  monitoringFeePaidMinor?: bigint;
  monitoringFeeWaivedMinor?: bigint;
};

export type LoanWriteOffAmounts = {
  principalWrittenOffMinor: bigint;
  interestWrittenOffMinor: bigint;
  feesWrittenOffMinor: bigint;
  penaltiesWrittenOffMinor: bigint;
};

function clamp(amount: bigint): bigint {
  return amount > 0n ? amount : 0n;
}

export function installmentDueMinor(installment: InstallmentAmounts): bigint {
  return (
    installment.principalDueMinor +
    installment.interestDueMinor +
    installment.feesDueMinor +
    installment.penaltiesDueMinor +
    (installment.monitoringFeeDueMinor ?? 0n)
  );
}

export function installmentPaidMinor(installment: InstallmentAmounts): bigint {
  return (
    installment.principalPaidMinor +
    installment.interestPaidMinor +
    installment.feesPaidMinor +
    installment.penaltiesPaidMinor +
    (installment.monitoringFeePaidMinor ?? 0n)
  );
}

export function installmentWaivedMinor(installment: InstallmentAmounts): bigint {
  return (
    (installment.principalWaivedMinor ?? 0n) +
    (installment.interestWaivedMinor ?? 0n) +
    (installment.feesWaivedMinor ?? 0n) +
    (installment.penaltiesWaivedMinor ?? 0n) +
    (installment.monitoringFeeWaivedMinor ?? 0n)
  );
}

/** Outstanding for a single installment row, ignoring any loan-level write-off. */
export function installmentOutstandingMinor(installment: InstallmentAmounts): bigint {
  return clamp(installmentDueMinor(installment) - installmentPaidMinor(installment) - installmentWaivedMinor(installment));
}

export function loanWrittenOffMinor(loan: LoanWriteOffAmounts): bigint {
  return loan.principalWrittenOffMinor + loan.interestWrittenOffMinor + loan.feesWrittenOffMinor + loan.penaltiesWrittenOffMinor;
}

/**
 * True outstanding balance for a loan: sum of installment due-paid-waived, minus whatever
 * was written off at the loan level. This is the number that should be shown anywhere the
 * app displays "outstanding" for a specific loan (loan detail, portal, list rows, reports).
 */
export function loanOutstandingMinor(
  installments: readonly (InstallmentAmounts & { dueOn?: Date })[],
  loan: LoanWriteOffAmounts,
  charges: readonly LoanChargeAmounts[] = [],
): bigint {
  const merged =
    charges.length === 0
      ? installments
      : installmentsWithCharges(
          installments.map((item) => ({ ...item, dueOn: item.dueOn ?? new Date(0) })),
          charges,
        );
  const dueMinor = merged.reduce((sum, item) => sum + installmentDueMinor(item), 0n);
  const paidMinor = merged.reduce((sum, item) => sum + installmentPaidMinor(item), 0n);
  const waivedMinor = merged.reduce((sum, item) => sum + installmentWaivedMinor(item), 0n);
  return clamp(dueMinor - paidMinor - waivedMinor - loanWrittenOffMinor(loan));
}

/**
 * Whether a loan status means the loan is settled and should never surface an "overdue"
 * or outstanding balance in reports/reminders, regardless of what raw due-paid arithmetic
 * says. Fineract records the write-off at the loan level, not per-installment, so an
 * individual installment's due-paid math can still look "overdue" after write-off unless
 * callers explicitly check the loan status first.
 */
export function isLoanSettledStatus(status: string): boolean {
  return status === "WRITTEN_OFF" || status === "CLOSED";
}

export type PrincipalAmounts = {
  principalDueMinor: bigint;
  principalPaidMinor: bigint;
  principalWaivedMinor?: bigint;
};

/**
 * Principal-only counterpart to `loanOutstandingMinor`, used for Portfolio at Risk (PAR),
 * which is defined on the principal balance alone — not the total due/outstanding across
 * principal + interest + fees + penalties. Same due-paid-waived-writtenOff identity, same
 * "sum first, clamp once at the loan level" rule (never clamp per installment first).
 */
export function principalOutstandingMinor(installments: readonly PrincipalAmounts[], principalWrittenOffMinor: bigint): bigint {
  const dueMinor = installments.reduce((sum, item) => sum + item.principalDueMinor, 0n);
  const paidMinor = installments.reduce((sum, item) => sum + item.principalPaidMinor, 0n);
  const waivedMinor = installments.reduce((sum, item) => sum + (item.principalWaivedMinor ?? 0n), 0n);
  return clamp(dueMinor - paidMinor - waivedMinor - principalWrittenOffMinor);
}

export type DatedInstallmentAmounts = InstallmentAmounts & { dueOn: Date };

export type LoanChargeAmounts = {
  name: string;
  amountMinor: bigint;
  status: string;
  dueOn: Date | null;
};

export function isPenaltyChargeName(name: string): boolean {
  return /penalt/i.test(name);
}

function sameUtcDay(left: Date, right: Date): boolean {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

function chargeTarget<T extends DatedInstallmentAmounts>(installments: T[], dueOn: Date | null): T {
  if (!dueOn) return installments[0];
  return installments.find((item) => sameUtcDay(item.dueOn, dueOn)) ?? installments[0];
}

function addChargeToInstallment(target: DatedInstallmentAmounts, charge: LoanChargeAmounts, penalty: boolean) {
  const paid = charge.status === "PAID";
  const waived = charge.status === "WAIVED";
  if (penalty) {
    target.penaltiesDueMinor += charge.amountMinor;
    if (paid) target.penaltiesPaidMinor += charge.amountMinor;
    if (waived) target.penaltiesWaivedMinor = (target.penaltiesWaivedMinor ?? 0n) + charge.amountMinor;
    return;
  }
  target.feesDueMinor += charge.amountMinor;
  if (paid) target.feesPaidMinor += charge.amountMinor;
  if (waived) target.feesWaivedMinor = (target.feesWaivedMinor ?? 0n) + charge.amountMinor;
}

function applyChargeComponent<T extends DatedInstallmentAmounts>(
  installments: T[],
  charges: readonly LoanChargeAmounts[],
  penalty: boolean,
) {
  const subset = charges.filter((charge) => isPenaltyChargeName(charge.name) === penalty);
  if (subset.length === 0) return;

  const scheduleDue = installments.reduce(
    (sum, item) => sum + (penalty ? item.penaltiesDueMinor : item.feesDueMinor),
    0n,
  );
  const schedulePaid = installments.reduce(
    (sum, item) => sum + (penalty ? item.penaltiesPaidMinor : item.feesPaidMinor),
    0n,
  );
  const scheduleWaived = installments.reduce(
    (sum, item) => sum + (penalty ? (item.penaltiesWaivedMinor ?? 0n) : (item.feesWaivedMinor ?? 0n)),
    0n,
  );
  const chargeOriginal = subset.reduce((sum, charge) => sum + charge.amountMinor, 0n);
  const chargePaid = subset.reduce((sum, charge) => sum + (charge.status === "PAID" ? charge.amountMinor : 0n), 0n);
  const chargeWaived = subset.reduce((sum, charge) => sum + (charge.status === "WAIVED" ? charge.amountMinor : 0n), 0n);

  if (scheduleDue === 0n) {
    for (const charge of subset) addChargeToInstallment(chargeTarget(installments, charge.dueOn), charge, penalty);
    return;
  }

  const extraDue = clamp(chargeOriginal - scheduleDue);
  const extraPaid = clamp(chargePaid - schedulePaid);
  const extraWaived = clamp(chargeWaived - scheduleWaived);
  if (extraDue === 0n && extraPaid === 0n && extraWaived === 0n) return;
  addChargeToInstallment(
    installments[0],
    { name: penalty ? "Penalty" : "Fee", amountMinor: extraDue, status: "PENDING", dueOn: null },
    penalty,
  );
  if (extraPaid > 0n) {
    if (penalty) installments[0].penaltiesPaidMinor += extraPaid;
    else installments[0].feesPaidMinor += extraPaid;
  }
  if (extraWaived > 0n) {
    if (penalty) installments[0].penaltiesWaivedMinor = (installments[0].penaltiesWaivedMinor ?? 0n) + extraWaived;
    else installments[0].feesWaivedMinor = (installments[0].feesWaivedMinor ?? 0n) + extraWaived;
  }
}

/**
 * iLend stored disbursement/specified-due-date fees (and some penalties) as Charge rows, not as
 * repayment-schedule feeChargesDue. Tables and outstanding math read installments, so fold in
 * any charge amounts the schedule is missing. Extra-only: if the schedule already has at least
 * as much as the charges, installments are unchanged — never double-count a Fineract period that
 * was imported alongside the same Charge rows.
 */
export function installmentsWithCharges<T extends DatedInstallmentAmounts>(
  installments: readonly T[],
  charges: readonly LoanChargeAmounts[],
): T[] {
  if (installments.length === 0 || charges.length === 0) return installments.map((item) => ({ ...item }));
  const copies = installments.map((item) => ({ ...item }));
  applyChargeComponent(copies, charges, false);
  applyChargeComponent(copies, charges, true);
  return copies;
}

export type LoanBalanceLine = Readonly<{
  key: string;
  label: string;
  original: bigint;
  paid: bigint;
  waived: bigint;
  overdue: bigint;
  outstanding: bigint;
}>;

function remainingOnInstallment(due: bigint, paid: bigint, waived: bigint): bigint {
  return clamp(due - paid - waived);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function overdueOnComponent(
  installments: readonly DatedInstallmentAmounts[],
  asOfDate: Date,
  settled: boolean,
  pick: (installment: DatedInstallmentAmounts) => { due: bigint; paid: bigint; waived: bigint },
): bigint {
  if (settled) return 0n;
  const today = startOfUtcDay(asOfDate);
  return installments.reduce((sum, installment) => {
    if (installment.dueOn >= today) return sum;
    const amounts = pick(installment);
    return sum + remainingOnInstallment(amounts.due, amounts.paid, amounts.waived);
  }, 0n);
}

/**
 * Fineract-style account summary: original / paid / waived / overdue / outstanding
 * for each repayment component, plus a total row.
 */
export function summarizeLoanBalance(
  installments: readonly DatedInstallmentAmounts[],
  loan: LoanWriteOffAmounts & { status: string },
  asOfDate: Date = new Date(),
  charges: readonly LoanChargeAmounts[] = [],
): { rows: readonly LoanBalanceLine[]; totals: LoanBalanceLine } {
  const settled = isLoanSettledStatus(loan.status);
  const schedule = installmentsWithCharges(installments, charges);
  const lines: LoanBalanceLine[] = [
    {
      key: "principal",
      label: "Loan amount",
      original: schedule.reduce((sum, item) => sum + item.principalDueMinor, 0n),
      paid: schedule.reduce((sum, item) => sum + item.principalPaidMinor, 0n),
      waived: schedule.reduce((sum, item) => sum + (item.principalWaivedMinor ?? 0n), 0n),
      overdue: overdueOnComponent(schedule, asOfDate, settled, (item) => ({
        due: item.principalDueMinor,
        paid: item.principalPaidMinor,
        waived: item.principalWaivedMinor ?? 0n,
      })),
      outstanding: principalOutstandingMinor(schedule, loan.principalWrittenOffMinor),
    },
    {
      key: "interest",
      label: "Interest",
      original: schedule.reduce((sum, item) => sum + item.interestDueMinor, 0n),
      paid: schedule.reduce((sum, item) => sum + item.interestPaidMinor, 0n),
      waived: schedule.reduce((sum, item) => sum + (item.interestWaivedMinor ?? 0n), 0n),
      overdue: overdueOnComponent(schedule, asOfDate, settled, (item) => ({
        due: item.interestDueMinor,
        paid: item.interestPaidMinor,
        waived: item.interestWaivedMinor ?? 0n,
      })),
      outstanding: clamp(
        schedule.reduce((sum, item) => sum + item.interestDueMinor - item.interestPaidMinor - (item.interestWaivedMinor ?? 0n), 0n) -
          loan.interestWrittenOffMinor,
      ),
    },
    {
      key: "fees",
      label: "Fees",
      original: schedule.reduce((sum, item) => sum + item.feesDueMinor, 0n),
      paid: schedule.reduce((sum, item) => sum + item.feesPaidMinor, 0n),
      waived: schedule.reduce((sum, item) => sum + (item.feesWaivedMinor ?? 0n), 0n),
      overdue: overdueOnComponent(schedule, asOfDate, settled, (item) => ({
        due: item.feesDueMinor,
        paid: item.feesPaidMinor,
        waived: item.feesWaivedMinor ?? 0n,
      })),
      outstanding: clamp(
        schedule.reduce((sum, item) => sum + item.feesDueMinor - item.feesPaidMinor - (item.feesWaivedMinor ?? 0n), 0n) -
          loan.feesWrittenOffMinor,
      ),
    },
    {
      key: "monitoring",
      label: "Monitoring fee",
      original: schedule.reduce((sum, item) => sum + (item.monitoringFeeDueMinor ?? 0n), 0n),
      paid: schedule.reduce((sum, item) => sum + (item.monitoringFeePaidMinor ?? 0n), 0n),
      waived: schedule.reduce((sum, item) => sum + (item.monitoringFeeWaivedMinor ?? 0n), 0n),
      overdue: overdueOnComponent(schedule, asOfDate, settled, (item) => ({
        due: item.monitoringFeeDueMinor ?? 0n,
        paid: item.monitoringFeePaidMinor ?? 0n,
        waived: item.monitoringFeeWaivedMinor ?? 0n,
      })),
      outstanding: clamp(
        schedule.reduce(
          (sum, item) =>
            sum + (item.monitoringFeeDueMinor ?? 0n) - (item.monitoringFeePaidMinor ?? 0n) - (item.monitoringFeeWaivedMinor ?? 0n),
          0n,
        ),
      ),
    },
    {
      key: "penalties",
      label: "Penalties",
      original: schedule.reduce((sum, item) => sum + item.penaltiesDueMinor, 0n),
      paid: schedule.reduce((sum, item) => sum + item.penaltiesPaidMinor, 0n),
      waived: schedule.reduce((sum, item) => sum + (item.penaltiesWaivedMinor ?? 0n), 0n),
      overdue: overdueOnComponent(schedule, asOfDate, settled, (item) => ({
        due: item.penaltiesDueMinor,
        paid: item.penaltiesPaidMinor,
        waived: item.penaltiesWaivedMinor ?? 0n,
      })),
      outstanding: clamp(
        schedule.reduce((sum, item) => sum + item.penaltiesDueMinor - item.penaltiesPaidMinor - (item.penaltiesWaivedMinor ?? 0n), 0n) -
          loan.penaltiesWrittenOffMinor,
      ),
    },
  ];

  const rows = lines.filter(
    (line) => line.key !== "monitoring" || line.original > 0n || line.paid > 0n || line.waived > 0n || line.outstanding > 0n,
  );
  const totals: LoanBalanceLine = {
    key: "total",
    label: "Total",
    original: rows.reduce((sum, line) => sum + line.original, 0n),
    paid: rows.reduce((sum, line) => sum + line.paid, 0n),
    waived: rows.reduce((sum, line) => sum + line.waived, 0n),
    overdue: rows.reduce((sum, line) => sum + line.overdue, 0n),
    outstanding: rows.reduce((sum, line) => sum + line.outstanding, 0n),
  };
  return { rows, totals };
}
