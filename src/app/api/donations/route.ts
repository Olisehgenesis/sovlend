import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

const blank = z.string().trim().max(80).optional().or(z.literal(""));

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().max(200),
  message: z.string().trim().max(1_000).optional().or(z.literal("")),
  moreBiodata: z.boolean(),
  country: blank,
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  city: blank,
});

function emptyToNull(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the donation details" }, { status: 400 });
  }

  const input = parsed.data;
  const more = input.moreBiodata;
  const donation = await prisma.donationRequest.create({
    data: {
      name: input.name,
      email: input.email,
      message: emptyToNull(input.message),
      moreBiodata: more,
      country: more ? emptyToNull(input.country) : null,
      phone: more ? emptyToNull(input.phone) : null,
      city: more ? emptyToNull(input.city) : null,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: donation.id }, { status: 201 });
}
