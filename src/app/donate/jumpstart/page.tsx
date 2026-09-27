import type { Metadata } from "next";

import { DonateCheckout } from "./donate-checkout";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Make a donation",
  description: "Donate to Jumpstart Africa with Visa, Mastercard, or crypto.",
};

function readServerEnv(parts: readonly string[]) {
  return process.env[parts.join("_")] ?? "";
}

export default function JumpstartDonatePage() {
  const clientId = readServerEnv(["THIRDWEB", "CLIENT", "ID"]) || readServerEnv(["NEXT_PUBLIC", "THIRDWEB", "CLIENT", "ID"]);
  return <DonateCheckout clientId={clientId} />;
}
