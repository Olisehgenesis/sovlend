import { createHash, randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import archiver from "archiver";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

import { readExportBytes, storeExportBytes } from "@/lib/export-storage";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";
import { loanExportQueue } from "@/modules/notifications/infrastructure/queues";
import {
  buildExportManifest,
  buildLoanExportDatasets,
  buildNestedExportJson,
  datasetColumns,
  rowsToCsv,
  type ExportLoanRecord,
  type LoanExportDatasets,
} from "../domain/loan-export";

export const exportScopeTypes = ["SINGLE_LOAN", "FILTERED", "PORTFOLIO"] as const;
export type ExportScopeType = (typeof exportScopeTypes)[number];
export const exportFormats = ["CSV_ZIP", "JSON"] as const;
export type ExportFormat = (typeof exportFormats)[number];

const singleLoanParamsSchema = z.object({ loanId: z.string().uuid() });
const filteredParamsSchema = z.object({
  status: z.enum(["APPROVED", "ACTIVE", "IN_ARREARS", "OVERPAID", "WRITTEN_OFF", "CLOSED"]).optional(),
  officeId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  loanOfficerId: z.string().optional(),
  arrears: z.boolean().optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
});
const portfolioParamsSchema = z.object({});

function parseScopeParams(scopeType: ExportScopeType, params: unknown) {
  if (scopeType === "SINGLE_LOAN") return singleLoanParamsSchema.parse(params);
  if (scopeType === "FILTERED") return filteredParamsSchema.parse(params);
  return portfolioParamsSchema.parse(params ?? {});
}

const loanInclude = {
  client: { select: { firstName: true, lastName: true, accountNumber: true } },
  office: { select: { name: true } },
  product: { select: { name: true } },
  loanOfficer: { select: { name: true } },
  installments: true,
  transactions: { include: { settlementAccount: { select: { name: true } }, reverses: { select: { id: true } } }, orderBy: { businessDate: "asc" as const } },
  charges: true,
  documents: true,
  notes: { include: { author: { select: { name: true } } } },
  collateralItems: true,
  reminders: true,
} satisfies Prisma.LoanInclude;

type LoanWithIncludes = Prisma.LoanGetPayload<{ include: typeof loanInclude }>;

/**
 * Stage a full-fidelity loan export job for asynchronous processing. Mirrors the maker-checker
 * modules' idempotency convention (a repeat request with the same idempotencyKey returns the
 * existing job rather than creating a duplicate), and freezes the requester's office scope onto
 * the job at request time so a later permission change cannot silently broaden what a queued
 * job is allowed to read.
 */
export async function requestLoanExport(
  prisma: PrismaClient,
  command: {
    actorUserId: string;
    organizationId: string;
    officeIds: readonly string[] | null;
    scopeType: ExportScopeType;
    scopeParams: unknown;
    format: ExportFormat;
    asOfDate: Date;
    idempotencyKey: string;
  },
) {
  const existing = await prisma.loanExportJob.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
  if (existing) return existing;

  await new AuthorizationService(prisma).assertAllowed({
    actorUserId: command.actorUserId,
    permission: permissions.loanView,
    organizationId: command.organizationId,
    officeId: command.officeIds?.[0] ?? null,
  });

  const parsedParams = parseScopeParams(command.scopeType, command.scopeParams);
  if (command.scopeType === "SINGLE_LOAN") {
    const params = parsedParams as z.infer<typeof singleLoanParamsSchema>;
    const loan = await prisma.loan.findFirst({
      where: {
        id: params.loanId,
        client: { organizationId: command.organizationId },
        ...(command.officeIds ? { officeId: { in: [...command.officeIds] } } : {}),
      },
      select: { id: true },
    });
    if (!loan) throw new Error("Loan not found in your scope");
  }

  const storedScopeParams: Prisma.InputJsonObject = {
    ...parsedParams,
    requesterOfficeIds: command.officeIds ? [...command.officeIds] : null,
  };

  const job = await prisma.loanExportJob.create({
    data: {
      organizationId: command.organizationId,
      requestedById: command.actorUserId,
      scopeType: command.scopeType,
      scopeParams: storedScopeParams,
      format: command.format,
      asOfDate: command.asOfDate,
      idempotencyKey: command.idempotencyKey,
    },
  });

  const correlationId = randomUUID();
  const metadata = { jobId: job.id, scopeType: command.scopeType, format: command.format, asOfDate: command.asOfDate.toISOString().slice(0, 10) };
  const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: "loan.export.requested", metadata })).digest("hex");
  await prisma.auditEvent.create({ data: { actorId: command.actorUserId, action: "loan.export.requested", entityType: "LoanExportJob", entityId: job.id, correlationId, metadata, eventHash } });
  await prisma.outboxEvent.create({ data: { aggregateType: "LoanExportJob", aggregateId: job.id, eventType: "loan.export.requested", payload: metadata } });

  await loanExportQueue.add(
    "process-export",
    { jobId: job.id },
    { jobId: job.id, attempts: 3, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 200, removeOnFail: 500 },
  );

  return job;
}

async function resolveLoans(prisma: PrismaClient, job: { scopeType: string; scopeParams: unknown; organizationId: string }): Promise<LoanWithIncludes[]> {
  const params = job.scopeParams as { requesterOfficeIds?: readonly string[] | null } & Record<string, unknown>;
  const officeIds = params.requesterOfficeIds ?? null;
  const officeFilter: Prisma.LoanWhereInput = officeIds ? { officeId: { in: [...officeIds] } } : {};

  if (job.scopeType === "SINGLE_LOAN") {
    const { loanId } = singleLoanParamsSchema.parse(params);
    return prisma.loan.findMany({ where: { id: loanId, client: { organizationId: job.organizationId }, ...officeFilter }, include: loanInclude });
  }

  if (job.scopeType === "FILTERED") {
    const filters = filteredParamsSchema.parse(params);
    const where: Prisma.LoanWhereInput = { client: { organizationId: job.organizationId }, ...officeFilter };
    if (filters.status) where.status = filters.status;
    if (filters.arrears) where.status = "IN_ARREARS";
    if (filters.officeId) where.officeId = filters.officeId;
    if (filters.productId) where.productId = filters.productId;
    if (filters.loanOfficerId) where.loanOfficerId = filters.loanOfficerId;
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {
        ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } : {}),
        ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {}),
      };
    }
    return prisma.loan.findMany({ where, include: loanInclude, orderBy: { createdAt: "asc" } });
  }

  // PORTFOLIO: every loan in the frozen office scope.
  return prisma.loan.findMany({ where: { client: { organizationId: job.organizationId }, ...officeFilter }, include: loanInclude, orderBy: { createdAt: "asc" } });
}

async function toExportRecords(prisma: PrismaClient, loans: LoanWithIncludes[]): Promise<ExportLoanRecord[]> {
  if (loans.length === 0) return [];
  const transactionIds = loans.flatMap((loan) => loan.transactions.map((transaction) => transaction.id));
  const applicationIds = loans.map((loan) => loan.applicationId);
  const loanIds = loans.map((loan) => loan.id);

  const [journals, auditEvents, allocations] = await Promise.all([
    transactionIds.length > 0
      ? prisma.journal.findMany({ where: { referenceId: { in: transactionIds } }, include: { lines: { include: { account: { select: { name: true } } } } } })
      : Promise.resolve([]),
    prisma.auditEvent.findMany({
      where: { OR: [{ entityType: "Loan", entityId: { in: loanIds } }, { entityType: "LoanApplication", entityId: { in: applicationIds } }] },
      include: { actor: { select: { name: true } } },
      orderBy: { occurredAt: "asc" },
    }),
    transactionIds.length > 0 ? prisma.loanTransactionAllocation.findMany({ where: { transactionId: { in: transactionIds } } }) : Promise.resolve([]),
  ]);

  const journalsByTransactionId = new Map<string, typeof journals>();
  for (const journal of journals) {
    if (!journal.referenceId) continue;
    const bucket = journalsByTransactionId.get(journal.referenceId) ?? [];
    bucket.push(journal);
    journalsByTransactionId.set(journal.referenceId, bucket);
  }
  const auditEventsByLoan = new Map<string, typeof auditEvents>();
  for (const loan of loans) {
    const events = auditEvents.filter(
      (event) => (event.entityType === "Loan" && event.entityId === loan.id) || (event.entityType === "LoanApplication" && event.entityId === loan.applicationId),
    );
    auditEventsByLoan.set(loan.id, events);
  }
  const allocationsByLoanTransactions = new Map<string, typeof allocations>();
  for (const loan of loans) {
    const transactionIdSet = new Set(loan.transactions.map((transaction) => transaction.id));
    allocationsByLoanTransactions.set(loan.id, allocations.filter((allocation) => transactionIdSet.has(allocation.transactionId)));
  }

  return loans.map((loan) => {
    const loanJournals = loan.transactions.flatMap((transaction) => journalsByTransactionId.get(transaction.id) ?? []);
    return {
      id: loan.id,
      accountNumber: loan.accountNumber,
      status: loan.status,
      denominationCurrency: loan.denominationCurrency,
      principalMinor: loan.principalMinor,
      disbursedOn: loan.disbursedOn,
      maturesOn: loan.maturesOn,
      createdAt: loan.createdAt,
      officeName: loan.office.name,
      clientAccountNumber: loan.client.accountNumber,
      clientName: `${loan.client.firstName} ${loan.client.lastName}`,
      productName: loan.product.name,
      loanOfficerName: loan.loanOfficer?.name ?? null,
      applicationId: loan.applicationId,
      installments: loan.installments,
      transactions: loan.transactions.map((transaction) => ({
        id: transaction.id,
        transactionType: transaction.transactionType,
        businessDate: transaction.businessDate,
        settlementCurrency: transaction.settlementCurrency,
        settlementChannel: transaction.settlementChannel,
        settlementAccountName: transaction.settlementAccount?.name ?? null,
        settlementAmountMinor: transaction.settlementAmountMinor,
        denominationAmountMinor: transaction.denominationAmountMinor,
        externalReference: transaction.externalReference,
        idempotencyKey: transaction.idempotencyKey,
        reversedById: transaction.reversedById,
        reversesId: transaction.reverses?.id ?? null,
        createdAt: transaction.createdAt,
      })),
      allocations: (allocationsByLoanTransactions.get(loan.id) ?? []).map((allocation) => ({
        id: allocation.id,
        transactionId: allocation.transactionId,
        installmentId: allocation.installmentId,
        principalMinor: allocation.principalMinor,
        interestMinor: allocation.interestMinor,
        feesMinor: allocation.feesMinor,
        penaltiesMinor: allocation.penaltiesMinor,
      })),
      charges: loan.charges,
      documents: loan.documents.map((document) => ({ id: document.id, name: document.name, description: document.description, mediaType: document.mediaType, sha256: document.sha256, objectKey: document.objectKey, createdAt: document.createdAt })),
      notes: loan.notes.map((note) => ({ id: note.id, body: note.body, authorName: note.author.name, createdAt: note.createdAt })),
      collateral: loan.collateralItems,
      journals: loanJournals.map((journal) => ({ id: journal.id, referenceType: journal.referenceType, referenceId: journal.referenceId, businessDate: journal.businessDate, narration: journal.narration, status: journal.status, postedAt: journal.postedAt })),
      journalLines: loanJournals.flatMap((journal) => journal.lines.map((line) => ({ id: line.id, journalId: line.journalId, accountName: line.account.name, direction: line.direction, amountMinor: line.amountMinor, memo: line.memo }))),
      auditEvents: (auditEventsByLoan.get(loan.id) ?? []).map((event) => ({ id: event.id, action: event.action, entityType: event.entityType, entityId: event.entityId, actorName: event.actor?.name ?? null, occurredAt: event.occurredAt, metadata: event.metadata })),
      reminders: loan.reminders.map((reminder) => ({ id: reminder.id, installmentId: reminder.installmentId, type: reminder.type, status: reminder.status, scheduledFor: reminder.scheduledFor, attempts: reminder.attempts, sentAt: reminder.sentAt })),
    };
  });
}

async function buildCsvZipBuffer(datasets: LoanExportDatasets, manifest: unknown): Promise<Buffer> {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  const collector = new PassThrough();
  collector.on("data", (chunk: Buffer) => chunks.push(chunk));
  archive.pipe(collector);

  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
  for (const key of Object.keys(datasets) as (keyof LoanExportDatasets)[]) {
    archive.append(rowsToCsv(datasets[key], datasetColumns[key]), { name: `${key}.csv` });
  }

  const finished = new Promise<void>((resolve, reject) => {
    collector.on("end", resolve);
    archive.on("error", reject);
  });
  await archive.finalize();
  await finished;
  return Buffer.concat(chunks);
}

/**
 * Processes a queued export job end to end: resolves the loan set frozen at request time,
 * gathers every child dataset (schedule, transactions, charges, docs, notes, collateral,
 * accounting, audit, reminders), builds the requested package, stores it, and marks the job
 * COMPLETED with its manifest — or FAILED with the error, never leaving it stuck PROCESSING.
 */
export async function processLoanExportJob(prisma: PrismaClient, jobId: string) {
  const job = await prisma.loanExportJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Export job not found");
  if (job.status === "COMPLETED" || job.status === "FAILED") return job;

  await prisma.loanExportJob.update({ where: { id: job.id }, data: { status: "PROCESSING", startedAt: new Date() } });

  try {
    const loans = await resolveLoans(prisma, job);
    const records = await toExportRecords(prisma, loans);
    const datasets = buildLoanExportDatasets(records, job.asOfDate);
    const manifest = buildExportManifest(datasets, { asOfDate: job.asOfDate, scopeType: job.scopeType, scopeParams: job.scopeParams, loanCount: records.length });

    const bytes =
      job.format === "JSON"
        ? Buffer.from(JSON.stringify(buildNestedExportJson(records, datasets, manifest), null, 2), "utf-8")
        : await buildCsvZipBuffer(datasets, manifest);

    const stored = await storeExportBytes(bytes);

    const completed = await prisma.loanExportJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        manifest: manifest as unknown as Prisma.InputJsonObject,
        resultObjectKey: stored.objectKey,
        resultByteSize: stored.byteSize,
        resultSha256: stored.sha256,
        completedAt: new Date(),
      },
    });

    const correlationId = randomUUID();
    const metadata = { jobId: job.id, loanCount: records.length, byteSize: stored.byteSize };
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: "loan.export.completed", metadata })).digest("hex");
    await prisma.auditEvent.create({ data: { actorId: null, action: "loan.export.completed", entityType: "LoanExportJob", entityId: job.id, correlationId, metadata, eventHash } });
    await prisma.outboxEvent.create({ data: { aggregateType: "LoanExportJob", aggregateId: job.id, eventType: "loan.export.completed", payload: metadata } });

    return completed;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Export failed";
    const failed = await prisma.loanExportJob.update({ where: { id: job.id }, data: { status: "FAILED", errorMessage, completedAt: new Date() } });
    const correlationId = randomUUID();
    const metadata = { jobId: job.id, errorMessage };
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: "loan.export.failed", metadata })).digest("hex");
    await prisma.auditEvent.create({ data: { actorId: null, action: "loan.export.failed", entityType: "LoanExportJob", entityId: job.id, correlationId, metadata, eventHash } });
    await prisma.outboxEvent.create({ data: { aggregateType: "LoanExportJob", aggregateId: job.id, eventType: "loan.export.failed", payload: metadata } });
    return failed;
  }
}

export async function readLoanExportPackage(objectKey: string): Promise<Buffer> {
  return readExportBytes(objectKey);
}
