-- CreateTable
CREATE TABLE "public"."LoanNote" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoanNote_loanId_idx" ON "public"."LoanNote"("loanId");

-- AddForeignKey
ALTER TABLE "public"."LoanNote" ADD CONSTRAINT "LoanNote_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "public"."Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoanNote" ADD CONSTRAINT "LoanNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
