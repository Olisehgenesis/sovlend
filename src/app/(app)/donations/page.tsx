import { HandCoins, Newspaper, Users } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { readDonationWalletBalanceUsdMinor } from "@/modules/donations/application/donation-wallet-balance";
import { loadDonationsReport } from "@/modules/donations/application/donations-report";
import { formatMinor } from "@/modules/money/domain/format-minor";

export const dynamic = "force-dynamic";

function receiverAddress(): string | null {
  const value = process.env.NEXT_PUBLIC_DONATION_RECEIVER_ADDRESS || "";
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value : null;
}

function formatDate(value: Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function statusLabel(status: string) {
  switch (status) {
    case "SUCCEEDED":
      return { label: "Succeeded", tone: "up-to-date" as const };
    case "PENDING":
      return { label: "Pending", tone: "review" as const };
    case "FAILED":
      return { label: "Failed", tone: "danger" as const };
    default:
      return { label: status, tone: "muted" as const };
  }
}

export default async function DonationsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const [report, walletUsdMinor] = await Promise.all([
    loadDonationsReport(prisma),
    readDonationWalletBalanceUsdMinor({ receiverAddress: receiverAddress() ?? undefined }),
  ]);
  const successPct = report.successRate === null ? null : Math.round(report.successRate);

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Donations" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Public giving</p>
          <h1>Donations</h1>
          <p>Payments collected into the donation wallet · {report.totalDonations.toLocaleString()} request{report.totalDonations === 1 ? "" : "s"}</p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href="/reports">
            Reports
          </Link>
        </div>
      </header>

      <section className="readiness-banner attention">
        <div>
          <strong>Wallet balance</strong>
          <span>
            {walletUsdMinor === null
              ? "Unable to read the donation wallet balance right now (chain unreachable or receiver address not configured)."
              : `≈ ${formatMinor(walletUsdMinor, "USD")} USDC currently held in the donation wallet on Base.`}
          </span>
        </div>
        <div className="readiness-progress">
          <i style={{ width: walletUsdMinor === null || walletUsdMinor === 0n ? "0%" : "100%" }} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Overview</h2>
            <p>Request status and donor summaries</p>
          </div>
          <HandCoins size={19} />
        </div>
        <dl className="detail-grid">
          <div><dt>Total requests</dt><dd>{report.totalDonations.toLocaleString()}</dd></div>
          <div><dt>Succeeded</dt><dd>{report.succeededCount.toLocaleString()}</dd></div>
          <div><dt>Not succeeded</dt><dd>{report.pendingCount.toLocaleString()}</dd></div>
          <div><dt>Success rate</dt><dd>{successPct === null ? "—" : `${successPct}%`}</dd></div>
          <div><dt>Succeeded value</dt><dd>{formatMinor(report.succeededUsdMinor, "USD")}</dd></div>
          <div><dt>All requests value</dt><dd>{formatMinor(report.totalUsdMinor, "USD")}</dd></div>
        </dl>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Donation records</h2>
            <p>Newest first</p>
          </div>
          <Newspaper size={19} />
        </div>
        {report.rows.length === 0 ? (
          <div className="empty-state">
            <Users size={28} />
            <strong>No donations yet</strong>
            <p>When donors give through the public donation page, their requests appear here.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Donor</th>
                  <th>Contact</th>
                  <th>Amount (USD)</th>
                  <th>Amount (sats)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDate(row.createdAt)}</td>
                    <td>
                      <strong>{row.donorName}</strong>
                      {row.country || row.city ? <small>{[row.city, row.country].filter(Boolean).join(", ")}</small> : null}
                    </td>
                    <td>
                      <small>{row.donorEmail}</small>
                      {row.phone ? <small>{row.phone}</small> : null}
                    </td>
                    <td>{row.amountUsdMinor === null ? "—" : formatMinor(row.amountUsdMinor, "USD")}</td>
                    <td>{row.amountSats === null ? "—" : row.amountSats.toLocaleString()}</td>
                    <td>
                      <span className={`status ${statusLabel(row.status).tone}`}>{statusLabel(row.status).label}</span>
                      <small>{formatDate(row.succeededAt)}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
