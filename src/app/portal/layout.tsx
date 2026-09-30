import Link from "next/link";

import { EntityAvatar } from "@/components/entity-avatar";
import { portalIconSrc } from "@/components/portal/portal-icon";
import { PortalNav } from "@/components/portal/portal-nav";
import { PortalSignOutButton } from "@/components/portal-sign-out-button";
import { SovLendMark } from "@/components/sovlend-mark";

import { getPortalClient } from "./_lib/portal-context";

export const metadata = { title: "Your wallet" };

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { client } = await getPortalClient();
  const name = [client.firstName, client.middleName, client.lastName].filter(Boolean).join(" ");

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <Link className="portal-brand" href="/portal">
          <SovLendMark />
          <span>Wallet</span>
        </Link>
        <div className="portal-header-user">
          <EntityAvatar seed={client.accountNumber} name={name} genderCode={client.genderCode} size={36} />
          <span className="portal-header-name">
            <strong>{client.firstName}</strong>
            <small>{client.accountNumber}</small>
          </span>
          <PortalSignOutButton />
        </div>
      </header>
      <div className="portal-body">
        <PortalNav walletIcon={portalIconSrc("sovlend-wallet")} activityIcon={portalIconSrc("sovlend-activity")} />
        <main className="portal-main">{children}</main>
      </div>
    </div>
  );
}
