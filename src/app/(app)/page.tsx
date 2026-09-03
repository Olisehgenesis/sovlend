import {
  Bitcoin,
  BookOpenText,
  CircleDollarSign,
  ShieldCheck,
} from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { formatMinor, loadDashboard } from "@/modules/reporting/application/dashboard";

const ugxCurrencyFormatter = new Intl.NumberFormat("en-UG", {
  style: "currency",
  currency: "UGX",
  maximumFractionDigits: 0,
});

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const dashboard = await loadDashboard(session.user.id);
  if (!dashboard) {
    return (
      <main className="setup-state">
        <ShieldCheck size={30} />
        <h1>Workspace assignment required</h1>
        <p>
          An administrator must connect this user to a SovLend organization before operational data can be shown.
        </p>
      </main>
    );
  }

  const investorCapital = dashboard.ownership.get("INVESTOR_CAPITAL") ?? 0n;
  const clientSavings = dashboard.ownership.get("CLIENT_SAVINGS") ?? 0n;
  const companyTreasury = dashboard.ownership.get("COMPANY_TREASURY") ?? 0n;
  const generatedAt = new Intl.DateTimeFormat("en-UG", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Africa/Kampala",
  }).format(dashboard.generatedAt);
  const btcObservedAt = dashboard.btcPrice
    ? new Intl.DateTimeFormat("en-UG", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Africa/Kampala",
      }).format(dashboard.btcPrice.observedAt)
    : null;
  const metricCards = [
    {
      href: "/loans",
      label: "Active portfolio",
      value: formatMinor(dashboard.metrics.portfolioMinor, dashboard.baseCurrency),
      detail: `${dashboard.metrics.activeLoanCount} active loans`,
    },
    {
      href: "/loans/due-today",
      label: "Due today",
      value: formatMinor(dashboard.metrics.dueTodayMinor, dashboard.baseCurrency),
      detail: `${dashboard.metrics.dueTodayCount} scheduled payments`,
    },
    {
      href: "/loans/collected-today",
      label: "Collected today",
      value: formatMinor(dashboard.metrics.collectedTodayMinor, dashboard.baseCurrency),
      detail: `${dashboard.metrics.repaymentCount} repayments recorded`,
    },
    {
      href: "/loans/disbursed-today",
      label: "Disbursed today",
      value: formatMinor(dashboard.metrics.disbursedTodayMinor, dashboard.baseCurrency),
      detail: `${dashboard.metrics.disbursementCount} loans disbursed`,
    },
    {
      href: "/loans?status=IN_ARREARS",
      label: "Portfolio at risk",
      value: `${(dashboard.metrics.portfolioAtRiskBps / 100).toFixed(2)}%`,
      detail: "Current overdue exposure",
    },
  ];

  return (
    <main className="content">
      <section className="page-heading">
        <div>
          <p className="eyebrow">{generatedAt}</p>
          <h1>Operations overview</h1>
          <p>{dashboard.officeName} portfolio and treasury position.</p>
        </div>
      </section>

      <section className="metrics" aria-label="Portfolio metrics">
        {metricCards.map((metric) => (
          <Link key={metric.label} className="metric-card" href={metric.href}>
            <article>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.detail}</small>
            </article>
          </Link>
        ))}
      </section>

      <section className="grid-main">
        <article className="panel portfolio-panel">
          <div className="panel-heading">
            <div>
              <h2>Portfolio movement</h2>
              <p>Disbursement and collection history</p>
            </div>
          </div>
          <div className="empty-state">
            <BookOpenText size={28} />
            <strong>No chart data yet</strong>
            <p>Activity will appear after transactions are migrated or recorded.</p>
          </div>
        </article>

        <aside className="capital-rail">
          <div className="panel-heading">
            <div>
              <h2>Capital position</h2>
              <p>Economic ownership, not wallet location</p>
            </div>
            <ShieldCheck size={19} />
          </div>
          <div className="rail-item investor">
            <span>Investor capital</span>
            <strong>{formatMinor(investorCapital, dashboard.baseCurrency)}</strong>
          </div>
          <div className="rail-item savings">
            <span>Client savings liability</span>
            <strong>{formatMinor(clientSavings, dashboard.baseCurrency)}</strong>
          </div>
          <div className="rail-item treasury">
            <span>Company treasury</span>
            <strong>{formatMinor(companyTreasury, dashboard.baseCurrency)}</strong>
          </div>
          <div className="custody">
            <span>
              <Bitcoin size={16} /> BTC/UGX
            </span>
            {dashboard.btcPrice ? (
              <>
                <strong>{ugxCurrencyFormatter.format(dashboard.btcPrice.priceUgx)}</strong>
                <small>
                  {dashboard.btcPrice.status.toLowerCase()} · {btcObservedAt}
                </small>
              </>
            ) : (
              <small>No fresh cached rate</small>
            )}
          </div>
        </aside>
      </section>

      <section className="panel loan-table">
        <div className="panel-heading">
          <div>
            <h2>Loans needing attention</h2>
            <p>Overdue or unpaid scheduled amounts</p>
          </div>
        </div>
        {dashboard.attentionLoans.length === 0 ? (
          <div className="empty-state">
            <CircleDollarSign size={28} />
            <strong>No loans need attention</strong>
            <p>Imported and newly issued loans will appear here when action is required.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Borrower</th>
                  <th>Account</th>
                  <th>Product</th>
                  <th>Amount due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.attentionLoans.map((loan) => (
                  <tr key={loan.id}>
                    <td>
                      <strong>{loan.borrower}</strong>
                    </td>
                    <td className="mono">{loan.account}</td>
                    <td>{loan.product}</td>
                    <td>{formatMinor(loan.dueMinor, loan.currencyCode)}</td>
                    <td>
                      <span className={`status ${loan.state.toLowerCase().replaceAll("_", "-")}`}>
                        {loan.state.replaceAll("_", " ")}
                      </span>
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
