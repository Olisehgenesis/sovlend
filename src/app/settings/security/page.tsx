import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PasskeySettings } from "@/components/passkey-settings";
import { auth } from "@/lib/auth";

export default async function SecurityPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return <PasskeySettings />;
}