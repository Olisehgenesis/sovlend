import Link from "next/link";

import { ActivityList } from "@/components/portal/activity-list";
import { BalanceSpark } from "@/components/portal/balance-spark";
import { EntityAvatar } from "@/components/entity-avatar";
import { PortalIcon } from "@/components/portal/portal-icon";
import { formatMinor } from "@/modules/money/domain/format-minor";

import { getPortalClient } from "./_lib/portal-context";
import { loadWallet } from "./_lib/wallet";

const dueFormat = new Intl.DateTimeFormat("en-UG", {
  day: "numeric",
  month: "short",
  timeZone: "Africa/Kampala",
});

export default async function PortalDashboardPage() {
  const { client } = await getPortalClient();
  const wallet = await loadWallet(client.id, 6);
  const name = [client.firstName, client.middleName, client.lastName].filter(Boolean).join(" ");

  return (
    <div className="portal-home">
      <div>
        <header className="portal-hello">
          <p>Hi {client.firstName}</p>
          <h1>Welcome back</h1>
        </header>

        <section className="portal-card" aria-label="Your balances">
          <div className="portal-card-face">
            <EntityAvatar seed={client.accountNumber} name={name} genderCode={client.genderCode} size={40} />
            <span>
              <strong>{name}</strong>
              <small>{client.accountNumber}</small>
            </span>
          </div>
          <strong className="portal-balance">{formatMinor(wallet.savingsTotal, wallet.savingsCurrency)}</strong>
          <span>Savings you hold</span>
          <div className="portal-actions">
            <Link href="/portal/activity">Activity</Link>
            <a href="#accounts">Accounts</a>
          </div>
        </section>

        <div className="portal-tiles">
          <article>
            <span>To repay</span>
            <strong>{formatMinor(wallet.owedTotal, wallet.owedCurrency)}</strong>
            <small>{wallet.nextDue ? `Next ${dueFormat.format(wallet.nextDue.when)}` : "Nothing due"}</small>
          </article>
          <article>
            <span>This month</span>
            <strong>{formatMinor(wallet.monthIn, wallet.savingsCurrency)}</strong>
            <small>Out {formatMinor(wallet.monthOut, wallet.savingsCurrency)}</small>
          </article>
        </div>

        <section className="portal-accounts" id="accounts" aria-labelledby="portal-accounts-title">
          <h2 id="portal-accounts-title">Your accounts</h2>
          {wallet.accounts.length === 0 ? (
            <p className="portal-empty">
              <strong>No accounts yet</strong>
              Loans and savings opened for you will appear here.
            </p>
          ) : (
            <ul className="portal-panel">
              {wallet.accounts.map((account) => (
                <li key={account.href}>
                  <Link href={account.href}>
                    <PortalIcon seed={account.seed} />
                    <span>
                      <strong>{account.title}</strong>
                      <small>{account.detail}</small>
                    </span>
                    <b>
                      <small>{account.amountLabel}</small>
                      {formatMinor(account.amountMinor, account.currency)}
                    </b>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="portal-feed portal-feed-mobile" aria-labelledby="portal-activity-title">
          <div className="portal-feed-head">
            <h2 id="portal-activity-title">Recent activity</h2>
            {wallet.activityTotal > wallet.activity.length ? <Link href="/portal/activity">See all</Link> : null}
          </div>
          <div className="portal-panel">
            <ActivityList items={wallet.activity} />
          </div>
        </section>
      </div>

      <section className="portal-overview" aria-labelledby="portal-overview-title">
        <header>
          <h2 id="portal-overview-title">Your balance</h2>
          <p>Savings over the last six months</p>
        </header>
        <BalanceSpark points={wallet.spark} />
        <strong>{formatMinor(wallet.savingsTotal, wallet.savingsCurrency)}</strong>
        <div className="portal-feed-head">
          <h2>Recent activity</h2>
          {wallet.activityTotal > wallet.activity.length ? <Link href="/portal/activity">See all</Link> : null}
        </div>
        <ActivityList items={wallet.activity} />
      </section>
    </div>
  );
}
