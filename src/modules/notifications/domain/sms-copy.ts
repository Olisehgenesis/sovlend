export function repaymentSmsMessage(input: {
  type: "REPAYMENT_DUE_SOON" | "REPAYMENT_DUE_TODAY" | "REPAYMENT_OVERDUE";
  amount: string;
  dueDate: string;
  fees?: string | null;
}): string {
  if (input.type === "REPAYMENT_DUE_TODAY") {
    return `JUMPSTART: Please pay your loan of ${input.amount} due TODAY (${input.dueDate}).`;
  }
  if (input.type === "REPAYMENT_OVERDUE") {
    const fees = input.fees ? ` including ${input.fees} in fees/penalties` : "";
    return `JUMPSTART: Please pay your loan of ${input.amount} which is OVERDUE (was due ${input.dueDate})${fees}.`;
  }
  return `JUMPSTART: Please pay your loan of ${input.amount} due on ${input.dueDate}.`;
}

export function standingOrderSmsMessage(amount: string, accountNumber: string): string {
  return `JUMPSTART: We collected ${amount} from your savings towards loan ${accountNumber}. Thank you.`;
}
