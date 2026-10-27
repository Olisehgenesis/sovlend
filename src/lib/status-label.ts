const labels: Record<string, string> = {
  ACTIVE: "Active",
  APPROVED: "Approved",
  BLOCKED: "Blocked",
  CLOSED: "Closed",
  DISBURSED: "Disbursed",
  DRAFT: "Draft",
  INACTIVE: "Inactive",
  IN_ARREARS: "In arrears",
  OVERPAID: "Overpaid",
  REJECTED: "Rejected",
  SUBMITTED: "Pending approval",
  WRITTEN_OFF: "Written off",
};

export function statusLabel(status: string) {
  return labels[status] ?? status.toLowerCase().replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}
