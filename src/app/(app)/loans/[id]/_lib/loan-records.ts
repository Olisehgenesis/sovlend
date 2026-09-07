import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope } from "@/modules/identity/application/data-scope";

const ugDateFormatter = new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" });
const ugDateTimeFormatter = new Intl.DateTimeFormat("en-UG", {
  dateStyle: "medium",
  timeStyle: "short",
});

export async function getLoanRouteContext(loanId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const loan = await prisma.loan.findFirst({
    where: {
      id: loanId,
      office: { organizationId: scope.organizationId },
    },
    include: {
      client: {
        select: { firstName: true, lastName: true, accountNumber: true },
      },
      group: { select: { name: true, accountNumber: true } },
      office: { select: { name: true } },
      product: { select: { name: true } },
      loanOfficer: { select: { name: true } },
    },
  });

  if (!loan || (scope.officeIds && !scope.officeIds.includes(loan.officeId))) {
    notFound();
  }

  return { session, scope, loan };
}

export function getLoanBorrowerLabel(loan: {
  client?: { firstName: string; lastName: string; accountNumber: string } | null;
  group?: { name: string; accountNumber: string } | null;
}) {
  return loan.client
    ? `${loan.client.firstName} ${loan.client.lastName}`
    : `Group: ${loan.group?.name ?? "Unknown"}`;
}

export function getLoanBorrowerAccount(loan: {
  client?: { accountNumber: string } | null;
  group?: { accountNumber: string } | null;
}) {
  return loan.client?.accountNumber ?? loan.group?.accountNumber ?? "—";
}

export function formatUgDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : ugDateFormatter.format(date);
}

export function formatUgDateTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : ugDateTimeFormatter.format(date);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
