import { prisma } from "@/lib/prisma";
import { isLoanPaymentTransaction, transactionTypeLabel, transactionTypeVariants } from "@/lib/loan-transaction-type-variants";
import { installmentOutstandingMinor, installmentsWithCharges, loanOutstandingMinor } from "@/modules/lending/domain/loan-outstanding";
import { displaySavingsProductName } from "@/modules/savings/domain/savings-product-label";

const disbursementTypes = new Set(transactionTypeVariants("DISBURSEMENT"));

export type WalletTone = "in" | "out" | "note";

export type WalletAccount = {
  href: string;
  seed: string;
  title: string;
  detail: string;
  amountMinor: bigint;
  currency: string;
  amountLabel: string;
};

export type WalletMovement = {
  id: string;
  href: string;
  seed: string;
  title: string;
  detail: string;
  when: Date;
  amountMinor: bigint;
  currency: string;
  tone: WalletTone;
};

export type WalletSnapshot = {
  savingsTotal: bigint;
  savingsCurrency: string;
  owedTotal: bigint;
  owedCurrency: string;
  nextDue: { when: Date; amountMinor: bigint; currency: string; href: string } | null;
  monthIn: bigint;
  monthOut: bigint;
  spark: bigint[];
  accounts: WalletAccount[];
  activity: WalletMovement[];
  activityTotal: number;
};

function add(totals: Map<string, bigint>, currency: string, amount: bigint) {
  totals.set(currency, (totals.get(currency) ?? 0n) + amount);
}

function primary(totals: Map<string, bigint>, fallback: string) {
  const ranked = [...totals.entries()].sort((left, right) => (right[1] > left[1] ? 1 : right[1] < left[1] ? -1 : 0));
  const first = ranked[0];
  return first ? { amount: first[1], currency: first[0] } : { amount: 0n, currency: fallback };
}

function plainWords(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function loanTone(type: string): WalletTone {
  if (disbursementTypes.has(type)) return "in";
  if (isLoanPaymentTransaction(type)) return "out";
  return "note";
}

export async function loadWallet(clientId: string, activityLimit: number): Promise<WalletSnapshot> {
  const [loans, savingsAccounts, savingsTotals, savingsRows, loanRows, savingsCount, loanCount] = await Promise.all([
    prisma.loan.findMany({
      where: { clientId },
      include: {
        product: { select: { name: true } },
        installments: true,
        charges: { select: { name: true, amountMinor: true, status: true, dueOn: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.savingsAccount.findMany({
      where: { clientId },
      include: { product: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.savingsTransaction.groupBy({
      by: ["savingsAccountId"],
      where: { savingsAccount: { clientId } },
      _sum: { amountMinor: true },
    }),
    prisma.savingsTransaction.findMany({
      where: { savingsAccount: { clientId } },
      orderBy: { createdAt: "desc" },
      take: activityLimit,
      include: { savingsAccount: { select: { accountNumber: true, currencyCode: true } } },
    }),
    prisma.loanTransaction.findMany({
      where: { loan: { clientId } },
      orderBy: { businessDate: "desc" },
      take: activityLimit,
      include: { loan: { select: { id: true, accountNumber: true, denominationCurrency: true } } },
    }),
    prisma.savingsTransaction.count({ where: { savingsAccount: { clientId } } }),
    prisma.loanTransaction.count({ where: { loan: { clientId } } }),
  ]);

  const balanceByAccount = new Map(savingsTotals.map((row) => [row.savingsAccountId, row._sum.amountMinor ?? 0n]));
  const savingsByCurrency = new Map<string, bigint>();
  const owedByCurrency = new Map<string, bigint>();
  const accounts: WalletAccount[] = [];
  let nextDue: WalletSnapshot["nextDue"] = null;

  for (const account of savingsAccounts) {
    const balance = balanceByAccount.get(account.id) ?? 0n;
    add(savingsByCurrency, account.currencyCode, balance);
    accounts.push({
      href: `/portal/savings/${account.accountNumber}`,
      seed: account.accountNumber,
      title: displaySavingsProductName(account.product?.name, "Savings"),
      detail: `${account.accountNumber} · ${plainWords(account.status)}`,
      amountMinor: balance,
      currency: account.currencyCode,
      amountLabel: "Balance",
    });
  }

  for (const loan of loans) {
    const schedule = installmentsWithCharges(loan.installments, loan.charges);
    const outstanding = loanOutstandingMinor(schedule, loan);
    add(owedByCurrency, loan.denominationCurrency, outstanding);
    accounts.push({
      href: `/portal/loans/${loan.id}`,
      seed: loan.accountNumber,
      title: loan.product.name,
      detail: `${loan.accountNumber} · ${plainWords(loan.status)}`,
      amountMinor: outstanding,
      currency: loan.denominationCurrency,
      amountLabel: "To repay",
    });

    for (const item of schedule) {
      const due = installmentOutstandingMinor(item);
      if (due <= 0n) continue;
      if (!nextDue || item.dueOn < nextDue.when) {
        nextDue = { when: item.dueOn, amountMinor: due, currency: loan.denominationCurrency, href: `/portal/loans/${loan.id}` };
      }
    }
  }

  const activity: WalletMovement[] = [
    ...savingsRows.map((row): WalletMovement => ({
      id: `savings-${row.id}`,
      href: `/portal/savings/${row.savingsAccount.accountNumber}`,
      seed: plainWords(row.transactionType),
      title: plainWords(row.transactionType),
      detail: row.savingsAccount.accountNumber,
      when: row.createdAt,
      amountMinor: row.amountMinor < 0n ? -row.amountMinor : row.amountMinor,
      currency: row.savingsAccount.currencyCode,
      tone: row.amountMinor < 0n ? "out" : row.amountMinor > 0n ? "in" : "note",
    })),
    ...loanRows.map((row) => ({
      id: `loan-${row.id}`,
      href: `/portal/loans/${row.loan.id}`,
      seed: transactionTypeLabel(row.transactionType),
      title: transactionTypeLabel(row.transactionType),
      detail: row.loan.accountNumber,
      when: row.businessDate,
      amountMinor: row.denominationAmountMinor < 0n ? -row.denominationAmountMinor : row.denominationAmountMinor,
      currency: row.loan.denominationCurrency,
      tone: loanTone(row.transactionType),
    })),
  ]
    .sort((left, right) => right.when.getTime() - left.when.getTime())
    .slice(0, activityLimit);

  const savings = primary(savingsByCurrency, "UGX");
  const owed = primary(owedByCurrency, savings.currency);
  const flow = await loadSavingsFlow(clientId, savings.currency, savings.amount);

  return {
    savingsTotal: savings.amount,
    savingsCurrency: savings.currency,
    owedTotal: owed.amount,
    owedCurrency: owed.currency,
    nextDue,
    monthIn: flow.monthIn,
    monthOut: flow.monthOut,
    spark: flow.spark,
    accounts,
    activity,
    activityTotal: savingsCount + loanCount,
  };
}

async function loadSavingsFlow(clientId: string, currency: string, balance: bigint) {
  const start = new Date();
  start.setMonth(start.getMonth() - 5);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const rows = await prisma.savingsTransaction.findMany({
    where: { savingsAccount: { clientId, currencyCode: currency }, createdAt: { gte: start } },
    select: { createdAt: true, amountMinor: true },
  });

  const buckets = Array.from({ length: 6 }, (_, index) => {
    const month = new Date(start);
    month.setMonth(start.getMonth() + index);
    return { key: `${month.getFullYear()}-${month.getMonth()}`, net: 0n };
  });
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  const now = new Date();
  const thisKey = `${now.getFullYear()}-${now.getMonth()}`;
  let monthIn = 0n;
  let monthOut = 0n;

  for (const row of rows) {
    const key = `${row.createdAt.getFullYear()}-${row.createdAt.getMonth()}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.net += row.amountMinor;
    if (key === thisKey) {
      if (row.amountMinor > 0n) monthIn += row.amountMinor;
      else monthOut += -row.amountMinor;
    }
  }

  const windowNet = buckets.reduce((sum, bucket) => sum + bucket.net, 0n);
  let running = balance - windowNet;
  const spark = buckets.map((bucket) => {
    running += bucket.net;
    return running;
  });

  return { monthIn, monthOut, spark };
}
