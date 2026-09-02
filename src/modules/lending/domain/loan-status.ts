export function determineServicingStatus(input: { currentStatus: string; totalOutstandingMinor: bigint; overdueOutstandingMinor: bigint }) {
  if (!["ACTIVE", "IN_ARREARS"].includes(input.currentStatus)) return input.currentStatus;
  if (input.totalOutstandingMinor <= 0n) return "CLOSED";
  if (input.overdueOutstandingMinor > 0n) return "IN_ARREARS";
  return "ACTIVE";
}