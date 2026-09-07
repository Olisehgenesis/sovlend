import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Shared auth + scope guard for every /portal page. Loads the Client record
 * linked to the signed-in User (via Client.authUserId) so all portal queries
 * can be scoped to `clientId: client.id` and never leak other clients' data.
 */
export async function getPortalClient() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const client = await prisma.client.findUnique({
    where: { authUserId: session.user.id },
    include: {
      office: { select: { name: true } },
      organization: { select: { name: true } },
    },
  });

  // No linked client record — this is a staff account, not a client. Send them home.
  if (!client) redirect("/");

  return { session, client };
}
