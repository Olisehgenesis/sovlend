import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

const schema = z.object({ organizationId: z.string().uuid(), name: z.string().trim().min(2).max(120), email: z.email(), message: z.string().trim().max(1_000).optional() });

export async function POST(request: Request) {
  const input = schema.parse(await request.json());
  const organization = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } });
  if (!organization) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  await prisma.investorAccessRequest.create({ data: input });
  return NextResponse.json({ requested: true }, { status: 201 });
}