const SAVINGS_PRODUCT_DISPLAY_NAMES: Record<string, string> = {
  "lif account savings": "Loan insurance fund",
  "compulsory savings": "Loan security payable",
  "compulsory saving": "Loan security payable",
  "member savings account": "Member contribution",
  "member savings": "Member contribution",
};

const STORED_SAVINGS_PRODUCT_NAMES = ["LIF Account Savings", "Compulsory savings", "Member Savings Account"] as const;

function normalizeAccountLabel(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function displaySavingsProductName(name: string | null | undefined, fallback = "Unlinked product") {
  if (!name?.trim()) return fallback;
  return SAVINGS_PRODUCT_DISPLAY_NAMES[normalizeAccountLabel(name)] ?? name;
}

export function storedSavingsProductNamesMatching(query: string) {
  const needle = normalizeAccountLabel(query);
  if (!needle) return [];
  return STORED_SAVINGS_PRODUCT_NAMES.filter((name) => {
    const stored = normalizeAccountLabel(name);
    const display = normalizeAccountLabel(displaySavingsProductName(name));
    return stored.includes(needle) || display.includes(needle);
  });
}
