import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppHeader } from "./app-header";
import { AppSidebar } from "./app-sidebar";
import { auth } from "@/lib/auth";
import { canManageProducts } from "@/lib/can-manage-products";
import { prisma } from "@/lib/prisma";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { organization: { select: { name: true } }, office: { select: { name: true } } },
  });
  const admin = session.user.role === "admin";
  const { allowed: products } = admin ? { allowed: true } : await canManageProducts(session);

  return (
    <div className="app-shell">
      <AppSidebar admin={admin} officeName={user?.office?.name} workspaceName={user?.organization?.name} />
      <div className="app-main">
        <AppHeader admin={admin} canManageProducts={products} officeName={user?.office?.name} workspaceName={user?.organization?.name} />
        {children}
      </div>
    </div>
  );
}
