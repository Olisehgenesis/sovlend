import { password } from "@inquirer/prompts";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const organizationName = process.env.BOOTSTRAP_ORGANIZATION_NAME ?? "Jump Start Africa";
const officeName = process.env.BOOTSTRAP_OFFICE_NAME ?? "Head Office";

async function main() {
  if (!email) throw new Error("BOOTSTRAP_ADMIN_EMAIL is required");
  if (await prisma.user.findUnique({ where: { email } })) {
    throw new Error(`An account already exists for ${email}`);
  }

  const [organization, office] = await Promise.all([
    prisma.organization.findFirstOrThrow({ where: { name: organizationName } }),
    prisma.office.findFirstOrThrow({ where: { name: officeName, organization: { name: organizationName } } }),
  ]);
  const secret = await password({
    message: "Super-admin password",
    mask: "*",
    validate: (value) => value.length >= 6 && value.length <= 128 ? true : "Use 6 to 128 characters",
  });

  const created = await auth.api.createUser({
    body: {
      email,
      password: secret,
      name: "SovLend Super Admin",
      role: "admin",
      data: {
        organizationId: organization.id,
        officeId: office.id,
        systemRole: "GENERAL_MANAGER",
      },
    },
  });

  try {
    const group = await prisma.permissionGroup.findUniqueOrThrow({
      where: { organizationId_name: { organizationId: organization.id, name: "General Manager" } },
    });
    await prisma.userPermissionAssignment.create({
      data: {
        userId: created.user.id,
        groupId: group.id,
        scope: "ORGANIZATION",
        officeId: null,
        includeChildOffices: true,
      },
    });
  } catch (error) {
    await prisma.user.delete({ where: { id: created.user.id } });
    throw error;
  }

  console.log(`Created ${email} for ${organizationName} with General Manager access.`);
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
