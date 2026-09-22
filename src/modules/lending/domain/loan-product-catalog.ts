import { parseRepaymentFrequency } from "./repayment-schedule";

export type CatalogProduct = Readonly<{
  name: string;
  shortName?: string;
  repaymentCount: number;
  repaymentFrequency: string;
  active?: boolean;
}>;

export type LoanProductCatalogGroup<T extends CatalogProduct> = Readonly<{
  label: "Daily" | "Weekly" | "Monthly" | "Other";
  products: T[];
}>;

const groupOrder = { Daily: 0, Weekly: 1, Monthly: 2, Other: 3 } as const;

export function formatLoanProductTerm(repaymentCount: number, repaymentFrequency: string): string {
  const parsed = tryParseFrequency(repaymentFrequency);
  if (!parsed) return `${repaymentCount} × ${repaymentFrequency}`;
  const unit = parsed.unit === "DAYS" ? "daily" : parsed.unit === "WEEKS" ? "weekly" : "monthly";
  if (parsed.every === 1) return `${repaymentCount} ${unit}`;
  const period = parsed.unit === "DAYS" ? "days" : parsed.unit === "WEEKS" ? "weeks" : "months";
  return `${repaymentCount} × every ${parsed.every} ${period}`;
}

export function loanProductMatchesQuery(product: CatalogProduct, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    product.name,
    product.shortName ?? "",
    product.repaymentFrequency,
    formatLoanProductTerm(product.repaymentCount, product.repaymentFrequency),
    catalogGroupLabel(product.repaymentFrequency),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function groupLoanProductsByTerm<T extends CatalogProduct>(products: readonly T[]): LoanProductCatalogGroup<T>[] {
  const sorted = [...products].sort(compareLoanProducts);
  const groups: LoanProductCatalogGroup<T>[] = [];
  for (const product of sorted) {
    const label = catalogGroupLabel(product.repaymentFrequency);
    const last = groups.at(-1);
    if (last?.label === label) last.products.push(product);
    else groups.push({ label, products: [product] });
  }
  return groups;
}

function compareLoanProducts(left: CatalogProduct, right: CatalogProduct): number {
  const leftActive = left.active === false ? 1 : 0;
  const rightActive = right.active === false ? 1 : 0;
  if (leftActive !== rightActive) return leftActive - rightActive;

  const leftKey = catalogSortKey(left);
  const rightKey = catalogSortKey(right);
  for (let index = 0; index < leftKey.length; index += 1) {
    const leftValue = leftKey[index];
    const rightValue = rightKey[index];
    if (typeof leftValue === "string" && typeof rightValue === "string") {
      const byName = leftValue.localeCompare(rightValue, undefined, { sensitivity: "base" });
      if (byName !== 0) return byName;
      continue;
    }
    if (leftValue !== rightValue) return Number(leftValue) - Number(rightValue);
  }
  return 0;
}

function catalogSortKey(product: CatalogProduct): Array<number | string> {
  const parsed = tryParseFrequency(product.repaymentFrequency);
  const label = catalogGroupLabel(product.repaymentFrequency);
  return [
    groupOrder[label],
    parsed?.every ?? Number.MAX_SAFE_INTEGER,
    product.repaymentCount,
    product.name,
  ];
}

function catalogGroupLabel(repaymentFrequency: string): LoanProductCatalogGroup<CatalogProduct>["label"] {
  const parsed = tryParseFrequency(repaymentFrequency);
  if (!parsed) return "Other";
  if (parsed.unit === "DAYS") return "Daily";
  if (parsed.unit === "WEEKS") return "Weekly";
  return "Monthly";
}

function tryParseFrequency(value: string) {
  try {
    return parseRepaymentFrequency(value);
  } catch {
    return null;
  }
}
