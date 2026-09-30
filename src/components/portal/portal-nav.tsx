"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function PortalNav({ walletIcon, activityIcon }: { walletIcon: string; activityIcon: string }) {
  const pathname = usePathname();
  const wallet = pathname === "/portal" || pathname.startsWith("/portal/loans") || pathname.startsWith("/portal/savings");
  const activity = pathname.startsWith("/portal/activity");

  return (
    <nav className="portal-nav" aria-label="Wallet">
      <Link href="/portal" aria-current={wallet ? "page" : undefined}>
        <img alt="" aria-hidden="true" height={22} src={walletIcon} width={22} />
        Wallet
      </Link>
      <Link href="/portal/activity" aria-current={activity ? "page" : undefined}>
        <img alt="" aria-hidden="true" height={22} src={activityIcon} width={22} />
        Activity
      </Link>
    </nav>
  );
}
