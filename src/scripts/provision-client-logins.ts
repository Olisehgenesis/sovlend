import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * One-time (idempotent) bulk provisioning of client self-service portal logins.
 *
 * For every Client without a linked login, this creates a User (systemRole=CLIENT,
 * scoped to the client's own organization/office) with:
 *   - email:    client.<accountNumber>@sovlend.local
 *   - password: the client's mobileNumber on file (matches src/app/api/auth/client-sign-in)
 * and links it back via Client.authUserId.
 *
 * Clients with no mobile number, or one shorter than better-auth's minPasswordLength (6),
 * are skipped and reported so an operator can fix the phone number and re-run.
 *
 * Safe to re-run: already-provisioned clients (authUserId set) are skipped.
 */
async function main() {
  const clients = await prisma.client.findMany({
    where: { authUserId: null },
    select: {
      id: true,
      accountNumber: true,
      organizationId: true,
      officeId: true,
      firstName: true,
      middleName: true,
      lastName: true,
      mobileNumber: true,
    },
    orderBy: { accountNumber: "asc" },
  });

  let created = 0;
  let skippedNoPhone = 0;
  let skippedEmailTaken = 0;
  const skippedAccounts: string[] = [];

  for (const client of clients) {
    const password = client.mobileNumber?.trim() ?? "";
    if (password.length < 6) {
      skippedNoPhone += 1;
      skippedAccounts.push(client.accountNumber);
      continue;
    }

    const emailLocalPart = client.accountNumber.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const email = `client.${emailLocalPart}@sovlend.local`;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      skippedEmailTaken += 1;
      skippedAccounts.push(client.accountNumber);
      continue;
    }

    const name = [client.firstName, client.middleName, client.lastName].filter(Boolean).join(" ");
    const createdUser = await auth.api.createUser({
      body: {
        email,
        password,
        name,
        role: "user",
        data: {
          organizationId: client.organizationId,
          officeId: client.officeId,
          systemRole: "CLIENT",
        },
      },
    });

    await prisma.client.update({
      where: { id: client.id },
      data: { authUserId: createdUser.user.id },
    });

    created += 1;
  }

  console.log(`Provisioned ${created} client login(s).`);
  console.log(`Skipped ${skippedNoPhone} client(s) with no usable mobile number.`);
  console.log(`Skipped ${skippedEmailTaken} client(s) with an email collision.`);
  if (skippedAccounts.length > 0) {
    console.log(`Skipped account numbers: ${skippedAccounts.join(", ")}`);
  }
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
