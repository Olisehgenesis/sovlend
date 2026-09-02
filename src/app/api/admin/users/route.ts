import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email(),
  password: z.string().min(6).max(128),
  organizationId: z.string().uuid(),
  officeId: z.string().uuid().nullable(),
  systemRole: z.enum(["ADMIN", "GENERAL_MANAGER", "BRANCH_MANAGER", "TELLER", "LOAN_OFFICER", "CLIENT", "INVESTOR", "TREASURY_SIGNER", "AUDITOR"]),
});

const groupForRole: Partial<Record<z.infer<typeof schema>["systemRole"], string>> = {
  ADMIN: "General Manager",
  GENERAL_MANAGER: "General Manager",
  BRANCH_MANAGER: "Branch Manager",
  TELLER: "Teller",
  LOAN_OFFICER: "Loan Officer",
  INVESTOR: "Investor",
  TREASURY_SIGNER: "Treasury Signer",
  AUDITOR: "Auditor",
};

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const input = schema.parse(await request.json());
  if (["BRANCH_MANAGER", "TELLER", "LOAN_OFFICER"].includes(input.systemRole) && !input.officeId) {
    return NextResponse.json({ error: "An office is required for this role" }, { status: 400 });
  }
  if (input.officeId) {
    const office = await prisma.office.findFirst({ where: { id: input.officeId, organizationId: input.organizationId } });
    if (!office) return NextResponse.json({ error: "Office does not belong to the selected organization" }, { status: 400 });
  }

  const created = await auth.api.createUser({
    body: {
      email: input.email,
      password: input.password,
      name: input.name,
      role: input.systemRole === "ADMIN" ? "admin" : "user",
      data: { organizationId: input.organizationId, officeId: input.officeId, systemRole: input.systemRole },
    },
  });

  try {
    const groupName = groupForRole[input.systemRole];
    if (groupName) {
      const group = await prisma.permissionGroup.findUniqueOrThrow({ where: { organizationId_name: { organizationId: input.organizationId, name: groupName } } });
      const organizationScope = ["ADMIN", "GENERAL_MANAGER", "TREASURY_SIGNER", "AUDITOR", "INVESTOR"].includes(input.systemRole);
      await prisma.userPermissionAssignment.create({
        data: {
          userId: created.user.id,
          groupId: group.id,
          scope: organizationScope ? "ORGANIZATION" : "OFFICE",
          officeId: organizationScope ? null : input.officeId,
          includeChildOffices: input.systemRole === "BRANCH_MANAGER",
        },
      });
    }
  } catch (error) {
    await prisma.user.delete({ where: { id: created.user.id } });
    throw error;
  }

  return NextResponse.json({
    user: { id: created.user.id, name: created.user.name, email: created.user.email, role: created.user.role, systemRole: input.systemRole },
  }, { status: 201 });
}