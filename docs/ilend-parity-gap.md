# iLend (Fineract) vs SovLend — Feature Parity Gap Analysis

Date: 2026-09-02
Source: `https://ilendloans.net/?tenantIdentifier=jumpstart` ("Ilend Global"), production tenant `jumpstart`.

## Method

The Ilend Global frontend is the Apache Fineract "community-app" (AngularJS), confirmed by the
page markup (`data-ng-controller="MainController"`) served from `ilendloans.net`. The same host
exposes the standard Fineract REST API at `/fineract-provider/api/v1/`. Using the credentials
supplied by the team (Robinah, a Super User with `ALL_FUNCTIONS`), this analysis was produced by
issuing **read-only `GET` requests only** against that API — no client, group, loan, or savings
record was created, edited, submitted, or deleted. Credentials were used ephemerally for this
session only and are not stored anywhere in the repository.

This is a snapshot of what the `jumpstart` tenant **actually uses today**, not the full
theoretical Fineract/Mifos feature set (which is much larger — shares, interoperability,
standing instructions, SMS campaigns, etc. were not observed in use here and are out of scope
unless the team asks for them).

## Production footprint observed

| Area | Finding |
|---|---|
| Offices | 2: "Head Office" (root) and "Entebbe Branch" (child) — a 2-level hierarchy |
| Staff | 14 loan officers/tellers, all at Head Office |
| Clients | 891 individual clients |
| Groups | 5 groups (e.g. "Kisigula Group", "MAKAI ROAD GROUP"), each with 10–15 client members |
| Roles | Super user, LOAN OFFICERS, CREDIT ANALYST, Self Service User, Loan officer audit, Accounting, loan modify and approver, Maker checker, Viewer, Loan Disburser, Deposit Manager |
| Loan products | 19, e.g. "20/30/40 WEEK LOAN", "Individual Loan weekly", "Micro-Enterprise Loan" (weekly/monthly), "Small business loan" (weekly = Flat, **monthly = Declining Balance**), "micro-loan daily repayment product", "GROUP LOAN PRODUCT", "EMERGENCY LOAN", "PERSONAL LOAN" — repayment frequencies: daily, weekly, monthly |
| Savings products | 6: "Member Savings Account", "Group general savings", "Compulsory savings", "Security Fee Payable" (individual + GF variant), "LIF Account Savings" (loan insurance fund) |
| Group scheduling | Groups carry a recurring **collection meeting calendar** (e.g. weekly every Thursday) used to schedule field collection visits |

## Feature comparison

| Feature | iLend (Fineract) | SovLend today | Status |
|---|---|---|---|
| Individual clients, KYC fields, office assignment | Yes | Yes (`Client` model) | ✅ Parity |
| Multi-level office hierarchy | Yes (Head Office → Branch) | Yes (`Office.parentId`) | ✅ Parity |
| Staff / loan officers, roles & permissions | Yes (11 named roles) | Yes (`UserPermissionAssignment` + permission groups) | ✅ Parity (mapping not yet audited role-by-role) |
| Individual loans: multiple products, weekly/monthly/daily repayment, flat interest | Yes | Yes (`LoanProduct.repaymentFrequency`, `interestMethod`) | ✅ Parity |
| Declining-balance interest calculation | Yes (at least one product uses it) | `interestMethod` is a free string on `LoanProduct`; **not confirmed whether the schedule generator actually implements declining-balance amortization**, only flat has been exercised in this session's work | ⚠️ Needs verification |
| Individual savings accounts | Yes | Yes (`SavingsAccount`) | ✅ Parity |
| **Groups as a roster** (members, notes, staff assignment) | Yes | Yes (`Group`, `GroupMember`, `GroupNote`) | ✅ Parity |
| **Group-owned loan account** ("GROUP LOAN PRODUCT" — the group itself is the borrower, not an individual) | Yes, actively configured | ✅ **Closed 2026-09-03** — `Loan.clientId`/`LoanApplication.clientId` are now optional, `groupId` added to both (FK to `Group`), a DB `CHECK` constraint enforces exactly one of `clientId`/`groupId` per row, and every loan-scoped route/service/UI page (list, detail, application review, new-application form, export CSV/JSON, dashboard, reminder scanner) was updated to read/display/scope group-owned loans correctly. The Group detail page also gained a "Loans" tab. See `prisma/migrations/20260903030000_group_owned_loans/`. | ✅ Parity |
| **Group-owned savings account** ("Group general savings") | Yes, actively configured | **No** — `SavingsAccount.clientId` is still a required FK; a savings account cannot be owned by a `Group` | ❌ Missing (not addressed in this pass; loans were prioritized per explicit ask) |
| **Group collection meeting calendar** (recurring schedule, e.g. weekly Thursday, drives field-collection reminders) | Yes | **No** — SovLend has no `Calendar`/recurrence concept anywhere in the schema | ❌ Missing |
| Mandatory/forced savings tied to loan disbursement ("Security Fee Payable", "LIF Account Savings") | Yes — these are savings products that appear to be collected alongside a loan | Charges exist (`Charge`, `ChargeDefinition`) but are manually created per loan/savings account today; there is no auto-applied "charge time type" (e.g. `DISBURSEMENT`) that fires a mandatory charge/forced-savings entry automatically | ⚠️ Partial — needs a charge/product "timing" rule to reach parity |
| Loan documents, notes, collateral, overdue/arrears tracking, service actions (undo disbursal/prepay/foreclosure/reversal), full-fidelity export | — (not specifically compared; this is SovLend's own recent Agent 1–6 work) | Yes, delivered in Agents 1–6 of this workstream | ✅ SovLend already exceeds a plain Fineract baseline here |

## Concrete gaps to close for "100% + more" parity

1. ✅ **Group-owned accounts (loans)** — DONE 2026-09-03: `Loan`/`LoanApplication` can now be owned
   by either a `Client` or a `Group` (Fineract's `accountType: individual | group`), enforced by a
   DB `CHECK` constraint. Group-owned **savings** accounts are still a gap (see below) — loans were
   prioritized first since that's where the explicit ask and highest financial-integrity risk sits.
2. **Collection meeting calendar** — a `Calendar`/`CalendarRecurrence` concept attached to a
   `Group` (and eventually a `Center`, if the team ever uses that Fineract concept — not observed
   in this tenant), so recurring collection dates can drive reminders the same way loan
   repayment reminders already do.
3. **Charge timing automation** — add a `chargeTimeType` (e.g. `DISBURSEMENT`,
   `SPECIFIED_DUE_DATE`, `OVERDUE_INSTALLMENT`) to `ChargeDefinition` so mandatory
   disbursement-linked charges/forced savings (Security Fee, LIF) are created automatically
   instead of by hand.
4. **Declining-balance interest** — verify (and if missing, implement) declining-balance
   amortization in the loan schedule generator, since at least one real product
   ("Small business loan(Monthly)") depends on it.
5. **Role-to-permission mapping audit** — walk the 11 named iLend roles against SovLend's
   permission groups one by one to confirm no role's capability is missing.

## Explicitly out of scope for this pass (not observed in production use)

Shares accounts, fixed/recurring deposits, standing instructions, SMS/email campaigns,
interoperability (Mojaloop), holidays/working-days calendars, batch API. None of these showed up
in the products/config actually configured on the `jumpstart` tenant, so they are not counted as
gaps unless the team says otherwise.

## Open items before the next phase (need a decision, not a guess)

1. **Data migration scope** — "100% data migration" could mean (a) migrating reference/config
   data only (offices, staff, products, roles) so SovLend's setup mirrors iLend's, or (b)
   migrating the full production ledger — all 891 clients, their loans, savings, groups, and
   transaction history — into SovLend. Option (b) is a real production-data operation (client
   PII + financial history) and should be scoped loan-by-loan/client-by-client as requested, with
   an explicit go-ahead before any data is written, per the plan to ask separately.

   **Update 2026-09-03 (decided autonomously, user unavailable):** `docs/STATUS.md` shows a
   pre-existing migration pass already imported 890/891 real clients, 2 offices, UGX currency, 19
   loan products, and 200 GL accounts from iLend into this sandbox — loan/savings/journal/
   attachment history was deliberately deferred. This pass extended `src/migration/` with
   `import-groups.ts` (read-only `getGroup`/`getGroupAccounts` against Fineract, idempotent via
   `externalId`) and generalized `import-loans.ts` to import loans for either a client or a group,
   wired end-to-end through `import-all.ts`/`cli.ts` (`MIGRATION_INCLUDE_GROUPS` env var). **The
   tooling is ready, but a fresh loan-by-loan/client-by-client production pull was *not* executed
   in this pass** — it would re-populate ~891 real clients' financial history from scratch into a
   local dev sandbox only (there is no live deployed SovLend to migrate into), which is a large,
   long-running, and irreversible-feeling operation that deserves an explicit go/no-go rather than
   a default. Run `pnpm migration:import-all-clients` (see `docs/loan-parity-roadmap.md` or
   `src/migration/cli.ts` usage output) with `MIGRATION_INCLUDE_GROUPS=true` when ready to execute.
2. **SSH target ("samserver") + nginx exposure** — no hostname, credentials, or existing
   deployment reference for a server named "samserver" exists in this repository or environment.
   This needs connection details before it can be attempted. **Status: still blocked, unchanged.**
