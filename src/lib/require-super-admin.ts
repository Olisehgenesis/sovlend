import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "./auth";

export async function requireSuperAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const allowedEmails = (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (session.user.role !== "admin" || !allowedEmails.includes(session.user.email.toLowerCase())) redirect("/");
  return session;
}