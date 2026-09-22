"use client";

import { Eye } from "lucide-react";
import { useMemo, useRef, type ReactNode, type RefObject } from "react";

import { Dialog, type DialogHandle } from "@/components/ui/dialog";
import { annualBpsFromMonthlyPercent } from "@/modules/lending/domain/monthly-rate";
import {
  describeRepaymentCadence,
  generateRepaymentSchedule,
  INTEREST_DAY_COUNT,
  parseRepaymentFrequency,
  readInterestDayCount,
  type InterestDayCount,
} from "@/modules/lending/domain/repayment-schedule";
import { formatMinor } from "@/modules/money/domain/format-minor";

export type LoanPreviewCharge = Readonly<{ name: string; amountLabel: string }>;

export type LoanPreviewInput = Readonly<{
  borrowerLabel: string;
  productName: string;
  currency: string;
  principalMinor: string;
  annualRatePercent: string;
  monitoringFeeAnnualRatePercent: string;
  repaymentCount: string;
  repaymentFrequency: string;
  interestMethod: string;
  amortizationMethod?: string;
  interestDayCount?: InterestDayCount | string | null;
  firstRepaymentOn?: string;
  charges?: readonly LoanPreviewCharge[];
  collateralLabel?: string;
  officerName?: string;
  purpose?: string;
}>;

function startOfUtcToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function formatDueOn(date: Date) {
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function dayCountLabel(dayCount: InterestDayCount) {
  return dayCount === INTEREST_DAY_COUNT.FOUR_WEEK_MONTH
    ? "Monthly rate, weekly collections"
    : "Actual/365";
}

export function LoanPreviewPanel({ input }: { input: LoanPreviewInput }) {
  const preview = useMemo(() => {
    const count = Number(input.repaymentCount);
    if (!input.principalMinor || !Number.isInteger(count) || count <= 0 || !input.repaymentFrequency.trim()) {
      return { error: "Add a principal, repayment count, and frequency to preview this loan." };
    }
    try {
      const dayCount = readInterestDayCount(input.interestDayCount);
      const schedule = generateRepaymentSchedule({
        principalMinor: BigInt(input.principalMinor),
        annualRateBps: annualBpsFromMonthlyPercent(Number(input.annualRatePercent || 0)),
        monitoringFeeAnnualRateBps: annualBpsFromMonthlyPercent(Number(input.monitoringFeeAnnualRatePercent || 0)),
        repaymentCount: count,
        repaymentFrequency: input.repaymentFrequency,
        interestMethod: input.interestMethod || "Flat",
        interestDayCount: dayCount,
        disbursedOn: startOfUtcToday(),
      });
      const firstDue = input.firstRepaymentOn ? new Date(`${input.firstRepaymentOn}T00:00:00Z`) : null;
      const shifted =
        firstDue && !Number.isNaN(firstDue.getTime())
          ? schedule.map((item) => ({
              ...item,
              dueOn: new Date(item.dueOn.getTime() + (firstDue.getTime() - schedule[0].dueOn.getTime())),
            }))
          : schedule;
      const totalInterest = shifted.reduce((sum, item) => sum + item.interestDueMinor, 0n);
      const totalMonitoring = shifted.reduce((sum, item) => sum + item.monitoringFeeDueMinor, 0n);
      const totalPrincipal = shifted.reduce((sum, item) => sum + item.principalDueMinor, 0n);
      const first = shifted[0];
      return {
        schedule: shifted,
        totalInterest,
        totalMonitoring,
        totalPrincipal,
        totalPayable: totalPrincipal + totalInterest + totalMonitoring,
        installmentDue: first.principalDueMinor + first.interestDueMinor + first.monitoringFeeDueMinor,
        cadence: describeRepaymentCadence(parseRepaymentFrequency(input.repaymentFrequency)),
        dayCount,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Could not build this repayment schedule." };
    }
  }, [input]);

  if ("error" in preview) {
    return <p className="muted-text">{preview.error}</p>;
  }

  const money = (amount: bigint) => formatMinor(amount, input.currency);

  return (
    <div className="loan-preview">
      <dl className="loan-preview-metrics">
        <div>
          <dt>Principal</dt>
          <dd>{money(preview.totalPrincipal)}</dd>
        </div>
        <div>
          <dt>Interest</dt>
          <dd>{money(preview.totalInterest)}</dd>
        </div>
        <div>
          <dt>Maintenance</dt>
          <dd>{money(preview.totalMonitoring)}</dd>
        </div>
        <div>
          <dt>Total payable</dt>
          <dd>{money(preview.totalPayable)}</dd>
        </div>
      </dl>
      <p className="loan-preview-installment">
        <strong>
          {money(preview.installmentDue)} {preview.cadence}
        </strong>
        <span>
          {preview.schedule.length} installments · {dayCountLabel(preview.dayCount)}. Dates assume disbursement today
          {input.firstRepaymentOn ? `, shifted to first repayment ${input.firstRepaymentOn}` : ""}.
        </span>
      </p>
      <dl className="detail-grid loan-preview-details">
        <div>
          <dt>Borrower</dt>
          <dd>{input.borrowerLabel || "—"}</dd>
        </div>
        <div>
          <dt>Product</dt>
          <dd>{input.productName || "—"}</dd>
        </div>
        <div>
          <dt>Loan officer</dt>
          <dd>{input.officerName || "Unassigned"}</dd>
        </div>
        <div>
          <dt>Purpose</dt>
          <dd>{input.purpose || "—"}</dd>
        </div>
        <div>
          <dt>Interest</dt>
          <dd>{input.annualRatePercent ? `${input.annualRatePercent}% per month` : "—"}</dd>
        </div>
        <div>
          <dt>Maintenance</dt>
          <dd>
            {input.monitoringFeeAnnualRatePercent
              ? `${input.monitoringFeeAnnualRatePercent}% per month`
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Repayment plan</dt>
          <dd>
            {input.repaymentCount} × {input.repaymentFrequency} · {input.interestMethod || "Flat"}
          </dd>
        </div>
        <div>
          <dt>Amortization</dt>
          <dd>{input.amortizationMethod || "Product default"}</dd>
        </div>
        <div>
          <dt>Charges</dt>
          <dd>
            {input.charges && input.charges.length > 0
              ? input.charges.map((charge) => `${charge.name} (${charge.amountLabel})`).join(", ")
              : "None"}
          </dd>
        </div>
        <div>
          <dt>Collateral</dt>
          <dd>{input.collateralLabel || "None"}</dd>
        </div>
      </dl>
      <div className="table-scroll loan-preview-schedule">
        <table>
          <thead>
            <tr>
              <th className="row-index">No.</th>
              <th>Due</th>
              <th className="numeric">Principal</th>
              <th className="numeric">Interest</th>
              <th className="numeric">Maintenance</th>
              <th className="numeric">Total</th>
            </tr>
          </thead>
          <tbody>
            {preview.schedule.map((item) => {
              const due = item.principalDueMinor + item.interestDueMinor + item.monitoringFeeDueMinor;
              return (
                <tr key={item.installmentNumber}>
                  <td className="row-index">{item.installmentNumber}</td>
                  <td>{formatDueOn(item.dueOn)}</td>
                  <td className="numeric">{money(item.principalDueMinor)}</td>
                  <td className="numeric">{money(item.interestDueMinor)}</td>
                  <td className="numeric">{money(item.monitoringFeeDueMinor)}</td>
                  <td className="numeric">{money(due)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function LoanPreviewDialog({
  dialogRef,
  input,
  title = "Loan preview",
  children,
}: {
  dialogRef: RefObject<DialogHandle | null>;
  input: LoanPreviewInput;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <Dialog className="loan-preview-modal" ref={dialogRef} title={title}>
      <LoanPreviewPanel input={input} />
      {children}
    </Dialog>
  );
}

export function LoanPreviewButton({
  input,
  label = "Preview loan",
}: {
  input: LoanPreviewInput;
  label?: string;
}) {
  const dialogRef = useRef<DialogHandle>(null);
  return (
    <>
      <button className="secondary-action" onClick={() => dialogRef.current?.showModal()} type="button">
        <Eye size={14} />
        {label}
      </button>
      <LoanPreviewDialog dialogRef={dialogRef} input={input} />
    </>
  );
}
