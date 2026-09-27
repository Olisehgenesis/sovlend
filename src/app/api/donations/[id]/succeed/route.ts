import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!zUuid(id)) return NextResponse.json({ error: "Donation not found" }, { status: 404 });

  const donation = await prisma.donationRequest.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!donation) return NextResponse.json({ error: "Donation not found" }, { status: 404 });
  if (donation.status === "SUCCEEDED") return NextResponse.json({ id: donation.id, status: donation.status });

  const updated = await prisma.donationRequest.update({
    where: { id },
    data: { status: "SUCCEEDED", succeededAt: new Date() },
    select: { id: true, status: true },
  });
  return NextResponse.json(updated);
}

function zUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
