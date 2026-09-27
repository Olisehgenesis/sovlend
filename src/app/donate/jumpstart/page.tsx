import type { Metadata } from "next";

import { DonateCheckout } from "./donate-checkout";

export const metadata: Metadata = {
  title: "Make a donation",
  description: "Donate to Jumpstart Africa with Visa, Mastercard, or crypto.",
};

export default function JumpstartDonatePage() {
  const clientId = process.env["THIRDWEB_CLIENT_ID"] || process.env["NEXT_PUBLIC_THIRDWEB_CLIENT_ID"] || "";
  return <DonateCheckout clientId={clientId} />;
}
