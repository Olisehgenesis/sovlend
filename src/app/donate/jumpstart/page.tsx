import type { Metadata } from "next";

import { DonateCheckout } from "./donate-checkout";
import { donationReturnUrl } from "./return-url";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Make a donation",
  description: "Donate to Jumpstart Africa with Visa, Mastercard, or crypto.",
};

function readServerEnv(parts: readonly string[]) {
  return process.env[parts.join("_")] ?? "";
}

export default async function JumpstartDonatePage({ searchParams }: { searchParams: Promise<{ return?: string }> }) {
  const { return: returnTo } = await searchParams;
  const clientId = readServerEnv(["THIRDWEB", "CLIENT", "ID"]) || readServerEnv(["NEXT_PUBLIC", "THIRDWEB", "CLIENT", "ID"]);
  return <DonateCheckout clientId={clientId} returnUrl={donationReturnUrl(returnTo)} />;
}
