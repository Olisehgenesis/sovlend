import { z } from "zod";

export const processingFeeBpsSchema = z.number().int().min(0).max(10_000);
export const processingFeePercentSchema = z.coerce.number().min(0).max(100).refine(
  (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
  "Use at most two decimal places",
);

export function processingFeeBps(snapshot: unknown, productBps = 200): number {
  if (snapshot && typeof snapshot === "object" && "processingFeeBps" in snapshot) {
    return processingFeeBpsSchema.parse(snapshot.processingFeeBps);
  }
  return processingFeeBpsSchema.parse(productBps);
}
