import Link from "next/link";

import { formatMinor } from "@/modules/money/domain/format-minor";

import type { WalletMovement } from "@/app/portal/_lib/wallet";
import { PortalIcon } from "./portal-icon";

const whenFormat = new Intl.DateTimeFormat("en-UG", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Kampala",
});

function signedAmount(item: WalletMovement) {
  const text = formatMinor(item.amountMinor, item.currency);
  if (item.tone === "in") return `+${text}`;
  if (item.tone === "out") return `−${text}`;
  return text;
}

export function ActivityList({ items }: { items: WalletMovement[] }) {
  if (items.length === 0) {
    return (
      <p className="portal-empty">
        <strong>No transactions yet</strong>
        Deposits, withdrawals, and loan payments will show up here.
      </p>
    );
  }

  return (
    <ul className="portal-feed-list">
      {items.map((item) => (
        <li key={item.id}>
          <Link href={item.href}>
            <PortalIcon seed={item.seed} />
            <span>
              <strong>{item.title}</strong>
              <small>
                {item.detail} · {whenFormat.format(item.when)}
              </small>
            </span>
            <b className={`portal-amount ${item.tone}`}>{signedAmount(item)}</b>
          </Link>
        </li>
      ))}
    </ul>
  );
}
