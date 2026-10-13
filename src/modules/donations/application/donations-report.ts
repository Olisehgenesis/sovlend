import type { Prisma, PrismaClient } from "@prisma/client";

type ReportDb = PrismaClient | Prisma.TransactionClient;

export type DonationReportRow = {
  id: string;
  donorName: string;
  donorEmail: string;
  message: string | null;
  country: string | null;
  city: string | null;
  phone: string | null;
  amountUsdMinor: bigint | null;
  amountSats: bigint | null;
  status: string;
  succeededAt: Date | null;
  createdAt: Date;
  paymentCount: number;
};

export type DonationSummary = {
  totalDonations: number;
  succeededCount: number;
  pendingCount: number;
  succeededUsdMinor: bigint;
  totalUsdMinor: bigint;
  successRate: number | null;
  rows: DonationReportRow[];
  generatedAt: Date;
};

/**
 * Loads donation requests for the organization's reporting scope. Donations are
 * not office-scoped (they come in via the public /donate page), so this returns
 * every record visible to managers/admins, newest first.
 */
export async function loadDonationsReport(db: ReportDb): Promise<DonationSummary> {
  const records = await db.donationRequest.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      email: true,
      message: true,
      country: true,
      city: true,
      phone: true,
      amountUsdMinor: true,
      amountSats: true,
      status: true,
      succeededAt: true,
      createdAt: true,
      _count: { select: { lightningInvoices: true } },
    },
  });

  const rows: DonationReportRow[] = records.map((record) => ({
    id: record.id,
    donorName: record.name,
    donorEmail: record.email,
    message: record.message,
    country: record.country,
    city: record.city,
    phone: record.phone,
    amountUsdMinor: record.amountUsdMinor,
    amountSats: record.amountSats,
    status: record.status,
    succeededAt: record.succeededAt,
    createdAt: record.createdAt,
    paymentCount: record._count.lightningInvoices,
  }));

  const succeeded = records.filter((r) => r.status === "SUCCEEDED");
  const succeededUsdMinor = succeeded.reduce((sum, r) => sum + (r.amountUsdMinor ?? 0n), 0n);
  const totalUsdMinor = records.reduce((sum, r) => sum + (r.amountUsdMinor ?? 0n), 0n);
  const successRate = records.length > 0 ? (succeeded.length / records.length) * 100 : null;

  return {
    totalDonations: records.length,
    succeededCount: succeeded.length,
    pendingCount: records.length - succeeded.length,
    succeededUsdMinor,
    totalUsdMinor,
    successRate,
    rows,
    generatedAt: new Date(),
  };
}
