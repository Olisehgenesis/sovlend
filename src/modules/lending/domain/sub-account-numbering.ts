/**
 * New loan and savings accounts are opened as numbered sub-accounts of their owning
 * client (or group), instead of unrelated random codes. The first account of a given
 * type takes the bare suffix (e.g. "000000926L"); subsequent accounts of the same type
 * append a running index (e.g. "000000926L2", "000000926L3", ...).
 *
 * This only governs NEW account numbers. Historical/migrated loans and savings accounts
 * keep whatever account number they were imported with.
 */
export function nextSubAccountNumber(baseAccountNumber: string, suffix: "L" | "S", existingCountOfSameType: number): string {
  return existingCountOfSameType === 0 ? `${baseAccountNumber}${suffix}` : `${baseAccountNumber}${suffix}${existingCountOfSameType + 1}`;
}
