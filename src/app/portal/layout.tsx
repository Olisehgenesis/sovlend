import Link from "next/link";

import { PortalSignOutButton } from "@/components/portal-sign-out-button";
import { SovLendMark } from "@/components/sovlend-mark";

import { getPortalClient } from "./_lib/portal-context";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { client } = await getPortalClient();
  const name = [client.firstName, client.middleName, client.lastName].filter(Boolean).join(" ");

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <Link className="portal-brand" href="/portal">
          <SovLendMark />
          <span>SovLend</span>
        </Link>
        <div className="portal-header-user">
          <span>
            <strong>{name}</strong>
            <small>
              {client.accountNumber} · {client.office.name}
            </small>
          </span>
          <PortalSignOutButton />
        </div>
      </header>
      <main className="portal-content">{children}</main>
    </div>
  );
}
