import type { Prisma } from "@prisma/client";
import { z } from "zod";

export const termsOverrideSchema = z.object({
  annualRateBps: z.number().int().nonnegative().optional(),
  monitoringFeeAnnualRateBps: z.number().int().nonnegative().optional(),
  repaymentCount: z.number().int().positive().optional(),
  repaymentFrequency: z.string().trim().min(1).optional(),
  interestMethod: z.string().trim().min(1).optional(),
  amortizationMethod: z.string().trim().min(1).optional(),
  interestRatePeriod: z.string().trim().min(1).optional(),
  firstRepaymentOn: z.iso.date().optional(),
  interestChargedFrom: z.iso.date().optional(),
  interestCalculationPeriod: z.string().trim().min(1).optional(),
  calculateExactDaysInPartialPeriod: z.boolean().optional(),
  arrearsToleranceMinor: z.string().regex(/^\d+$/).optional(),
  interestFreePeriod: z.number().int().nonnegative().optional(),
  repaymentStrategy: z.string().trim().min(1).optional(),
  moratoriumPrincipal: z.boolean().optional(),
  moratoriumInterest: z.boolean().optional(),
  moratoriumArrearsAging: z.boolean().optional(),
  isTopupLoan: z.boolean().optional(),
  recalculateInterest: z.boolean().optional(),
  daysInMonth: z.string().trim().min(1).optional(),
});

export const chargeSelectionSchema = z.object({
  chargeDefinitionId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(150),
  amountMinor: z.string().regex(/^\d+$/),
  collectedOn: z.string().trim().optional(),
});

export const collateralItemSchema = z.object({
  type: z.string().trim().max(150).optional(),
  description: z.string().trim().max(1_000).optional(),
  estimatedValueMinor: z.string().regex(/^\d+$/).optional(),
});

export const createLoanApplicationSchema = z
  .object({
    clientId: z.string().uuid().optional(),
    groupId: z.string().uuid().optional(),
    productId: z.string().uuid(),
    // User.id is a plain string (better-auth generated), not a UUID — do not validate as uuid().
    loanOfficerId: z.string().trim().min(1).optional(),
    fundId: z.string().uuid().optional(),
    proposedPrincipalMinor: z.string().regex(/^\d+$/),
    purpose: z.string().trim().max(1_000).optional(),
    externalId: z.string().trim().max(150).optional(),
    applicationExpiresOn: z.iso.date().optional(),
    terms: termsOverrideSchema.optional(),
    charges: z.array(chargeSelectionSchema).max(50).optional(),
    collateral: z.array(collateralItemSchema).max(50).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.clientId) !== Boolean(value.groupId), { message: "Provide exactly one of clientId or groupId" });

const optionalNullableTrimmedString = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.union([z.string().max(max), z.null()]).optional(),
  );

const optionalNullableDateString = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  },
  z.union([z.iso.date(), z.null()]).optional(),
);

const optionalNullableLoanOfficerId = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  },
  z.union([z.string().trim().min(1), z.null()]).optional(),
);

const optionalNullableUuid = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  },
  z.union([z.string().uuid(), z.null()]).optional(),
);

export const updateLoanApplicationSchema = z
  .object({
    proposedPrincipalMinor: z.string().regex(/^\d+$/).optional(),
    purpose: optionalNullableTrimmedString(1_000),
    externalId: optionalNullableTrimmedString(150),
    applicationExpiresOn: optionalNullableDateString,
    fundId: optionalNullableUuid,
    loanOfficerId: optionalNullableLoanOfficerId,
    terms: termsOverrideSchema.optional(),
    charges: z.array(chargeSelectionSchema).max(50).optional(),
    collateral: z.array(collateralItemSchema).max(50).optional(),
  })
  .strict();

export type TermsOverride = z.infer<typeof termsOverrideSchema>;
export type ChargeSelection = z.infer<typeof chargeSelectionSchema>;
export type CollateralItem = z.infer<typeof collateralItemSchema>;

function stripUndefinedEntries<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function buildTermsSnapshot(terms: TermsOverride | undefined): Prisma.InputJsonObject | undefined {
  if (!terms) return undefined;
  const cleaned = stripUndefinedEntries(terms);
  return Object.keys(cleaned).length > 0 ? (cleaned as Prisma.InputJsonObject) : undefined;
}

export function buildChargeSnapshot(charges: readonly ChargeSelection[] | undefined): Prisma.InputJsonArray | undefined {
  if (!charges) return undefined;
  return charges.map((charge) => stripUndefinedEntries(charge) as Prisma.InputJsonObject) as Prisma.InputJsonArray;
}

export function buildCollateralSnapshot(collateral: readonly CollateralItem[] | undefined): Prisma.InputJsonArray | undefined {
  if (!collateral) return undefined;
  return collateral.map((item) => stripUndefinedEntries(item) as Prisma.InputJsonObject) as Prisma.InputJsonArray;
}

export function readTermsSnapshot(value: unknown): TermsOverride {
  const record = asRecord(value);
  if (!record) return {};
  const parsed = termsOverrideSchema.safeParse(record);
  return parsed.success ? (stripUndefinedEntries(parsed.data) as TermsOverride) : {};
}

export function readChargeSnapshot(value: unknown): ChargeSelection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = chargeSelectionSchema.safeParse(item);
    return parsed.success ? [(stripUndefinedEntries(parsed.data) as ChargeSelection)] : [];
  });
}

export function readCollateralSnapshot(value: unknown): CollateralItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = collateralItemSchema.safeParse(item);
    return parsed.success ? [(stripUndefinedEntries(parsed.data) as CollateralItem)] : [];
  });
}
