# SovLend UX & Frontend Architecture Audit

Audit date: 8 September 2026
Scope: Next.js app router codebase at `src/app/**` and shared components at `src/components/**`, as it exists today on this branch. This is a **report-only, read-only** audit. No application code was changed as part of this exercise.

Method: full app-router route tree mapped (`src/app/(app)/**`, `src/app/api/**`, `src/app/portal/**`, `src/app/investor/**`); every shared component in `src/components/` inventoried; realistic operator journeys traced end-to-end (client → loan application → approval → disbursement → repayment; client → savings account → deposit); duplication checked with direct file diffs, not assumption. Every finding below cites the exact file(s) (and line numbers where useful) that were actually read.

---

## 1. Overall UX assessment

SovLend's operator app is a from-scratch Next.js replacement for a legacy Fineract/Mifos-style system (see `SYSTEM_AUDIT.md`), and for a from-scratch rebuild it is **more disciplined than average**: every list page has an empty state, breadcrumbs are used consistently, money is formatted through a single `formatMinor` helper, loan-application terms are snapshotted at approval time so live product edits can't retroactively change an issued loan (`src/app/(app)/loans/[id]/page.tsx:29-33`), and several context-passing patterns are done correctly (e.g. "Add loan" from a client's profile pre-selects that client on `/loans/new` rather than re-asking for identity — `src/components/client-account-panel.tsx:216`, `src/app/(app)/loans/new/page.tsx:14-40`).

However, the app has **no shared UI primitive layer at all**. There is no `components/ui/` directory, no table/dialog/dropdown/form-field component, and no UI library dependency (`package.json` has zero of react-hook-form, radix, shadcn, headlessui, or any table/dialog package — confirmed by inspecting `dependencies`/`devDependencies`). Every one of the 44 files in `src/components/` is a bespoke, feature-specific component. As a direct consequence, the same visual/interaction patterns (data tables, dialogs, empty states, form-submit-with-toast) are hand-rolled independently dozens of times, with small but real drift between copies. Two competing top-level navigation shells are rendered simultaneously, and a third, unused nav component exists as dead code. The most repetitive area is Reports (~30 near-identical pages), followed by the loan and client list/detail pages.

Overall: solid data model and a genuinely good "don't re-ask what we already know" instinct in a few key flows, undermined by an absence of shared building blocks that is producing measurable, quantifiable duplication as the app grows.

---

## 2. Major problems discovered

1. **Two full primary navigation systems render at the same time.** `AppShell` (`src/components/app-shell.tsx:36-44`) renders both `AppSidebar` and `AppHeader` on every authenticated page. Both independently encode nearly the same route map — Clients, Loans (+ new application, applications, exports), Groups, Savings, Reports, Backoffice, Admin/Users, Settings/Team, Security — see `src/components/app-sidebar.tsx:128-191` vs. `src/components/app-header.tsx:62-266`. Users get two different visual metaphors (collapsible left rail + dropdown top bar) for the same choices, and every future nav change must be made twice.
2. **A third, dead navigation component exists in the codebase.** `src/components/operations-nav.tsx` implements yet another full nav bar (single unformatted line, minified) and is not imported anywhere else in `src` (verified by grep) — genuine dead code that will confuse the next person who finds it and wonders if it's actually wired up somewhere.
3. **No shared table/dialog/empty-state components**, leading to 3+ independent re-implementations of `<table className="clickable-rows">` markup (`src/app/(app)/clients/page.tsx:216-248`, `src/app/(app)/groups/page.tsx:183-212`, `src/app/(app)/loans/applications/page.tsx:224-280`) and 5 independent native `<dialog>`-based modal implementations (`new-savings-account-wizard.tsx`, `loan-service-actions-panel.tsx`, `disburse-loan-button.tsx`, `reverse-disbursement-button.tsx`, `record-payment-button.tsx`).
4. **The loan detail page is an information/navigation dead end relative to its own client.** `src/app/(app)/loans/[id]/page.tsx` shows the borrower's name as plain text with no link (lines 201-203, 292-296) and its breadcrumb is only `Loans / {accountNumber}` (lines 194-196) — there is no way back to the client profile from a loan, and no "other loans for this client" surfaced, even though the equivalent savings account detail page **does** link back to its owning client/group (`src/app/(app)/savings-accounts/[accountNumber]/page.tsx:122-129,172`). This asymmetry was independently confirmed by direct inspection.
5. **A real functional bug in the disbursement form**, discovered while auditing validation consistency: in `disburse-loan-form.tsx`, the branch that fires when no settlement account is selected shows a toast but does not reset `pending` back to `false`, so the submit button can remain stuck disabled after a failed validation until the component remounts.
6. **`loans/collected-today` and `loans/disbursed-today` are ~99% duplicate files** (164 lines each) differing only in a transaction-type filter and copy strings (confirmed by direct `diff`), and `due-today` (242 lines) redefines the same `startOfUtcDay()`/`borrowerLabel()`/`loanStatusTone()` helpers a third time.
7. **~30 individual report pages under `src/app/(app)/reports/**` share only a "jump to report" dropdown** (`src/components/report-picker.tsx`) — every page (200-232 lines each, e.g. `reports/risk/arrears/page.tsx`, `reports/operations/collections/page.tsx`, `reports/accounting/trial-balance/page.tsx`) independently reimplements its filter form, table, and the CSV export button/href construction (`exportHref` built ad hoc in each file).

---

## 3. Repeated/duplicated forms

| Duplicated pattern | Files | What's duplicated | Recommendation |
|---|---|---|---|
| "Today" transaction list pages | `src/app/(app)/loans/collected-today/page.tsx`, `disbursed-today/page.tsx` (164 lines each, ~99% identical per direct diff), `due-today/page.tsx` (242 lines, same helpers redefined) | Entire page: query shape, `startOfUtcDay()`, `borrowerLabel()`, `loanStatusTone()`, table JSX | Extract a shared `today-transactions` factory/component parameterized by transaction type; keep `due-today`'s installment-aggregation logic separate only if it truly can't share the table. |
| Attached-item panels | `src/components/loan-charge-panel.tsx` (156 lines) vs. `src/components/loan-collateral-panel.tsx` (153 lines) | Nearly identical state management, create/delete async handlers, table scaffolding, empty state, `entity-form compact-mapping` create form, toast/refresh flow — differing only in field names and action verbs | Extract a generic `<AttachedItemsPanel>` accepting `items`, column defs, and create/mutate handlers. |
| Entity list tables | `src/app/(app)/clients/page.tsx:216-248`, `src/app/(app)/groups/page.tsx:183-212`, `src/app/(app)/loans/applications/page.tsx:224-280` | `<table className="clickable-rows">` structure, hidden `.row-link` click-through pattern, per-row cell composition | Extract a `<DataTable columns rows onRowClick emptyState>` component. |
| Report filter/table/export scaffolding | ~30 pages under `src/app/(app)/reports/**` (e.g. `risk/arrears/page.tsx`, `operations/collections/page.tsx`, `accounting/trial-balance/page.tsx`, `savings/transactions/page.tsx`) | Filter form layout, table rendering, and CSV export link/button (`exportHref` + `<a className="secondary-action"><Download/>Export CSV</a>`) rebuilt per page | Extract a `<ReportShell>` wrapping breadcrumbs + `ReportPicker` + filter bar + table + export button, parameterized by report-specific columns/query. |
| Form submit boilerplate | Present in effectively every `src/components/*-form.tsx` file (e.g. `create-client-form.tsx:8-44`, `repayment-form.tsx`, `approve-loan-form.tsx`) | `useState(pending)` → `fetch()` → `toast.error/success` → `router.refresh()` sequence hand-typed in each form | Extract a `useFormAction` hook to DRY the pending/fetch/toast/refresh cycle (this is a consistent *pattern*, but the boilerplate itself is duplicated dozens of times). |

Notably **not** duplicated, and worth calling out as good practice: `loan-application-form-shared.ts` correctly centralizes `toMinor`/`fromMinor`, charge/collateral/terms payload building, and is imported by both `create-loan-application-form.tsx` and `edit-loan-application-form.tsx` — this is the one place multi-consumer business logic was actually shared.

---

## 4. Navigation problems

- **Dual primary nav (Critical).** `AppSidebar` and `AppHeader` both render in `AppShell` (`src/components/app-shell.tsx:36-44`) and both encode the same route map independently (`src/components/app-sidebar.tsx:128-191`, `src/components/app-header.tsx:62-266`). This is not two views into one nav config — they are two hand-maintained lists that must be kept in sync manually (e.g. `app-header.tsx` adds status-filtered deep links like `/loans?status=IN_ARREARS` that `app-sidebar.tsx` does not have at all).
- **Dead nav component.** `src/components/operations-nav.tsx` is unreferenced anywhere else in `src` — confirmed via grep. It should either be wired up (if it was meant to replace one of the other two) or deleted.
- **`/backoffice/funds` is not in either primary nav**, but is discoverable via a card link on the `/backoffice` hub page (`src/app/(app)/backoffice/page.tsx:22`, `management-link` grid) — two clicks deep and inconsistent with the fact that Products and Accounting (its siblings on that same hub page) *are* also promoted into `AppSidebar`'s Administration section (`src/components/app-sidebar.tsx:183-188`). Minor IA inconsistency, not a true orphan.
- **Two separate "manage users" destinations with no cross-link.** `/admin/users` (`src/app/(app)/admin/users/page.tsx` → `AdminUsersPanel`) creates/edits user accounts (org, office, role, banned state); `/settings/team` (`src/app/(app)/settings/team/page.tsx` → `TeamPermissionsPanel`) manages permission groups and assigns them to users. Grepping both `admin-users-panel.tsx` and `team-permissions-panel.tsx` shows **zero cross-links** between them — an admin provisioning a new user must independently discover and navigate to the other page to grant it any permissions, with nothing on either page prompting that next step.
- **Report pages are catalog-driven, not statically linked**, which is appropriate for ~30 pages (`AppSidebar`'s Reports section is generated from `loadVisibleReportSections` in `src/modules/reports/report-catalog.ts`, and `AppHeader` mirrors the same list) — this is a reasonable pattern, not a problem, but it does mean discoverability entirely depends on that catalog staying complete and permission-filtered correctly; there's no fallback static list a developer could sanity-check against by eye.

---

## 5. Information architecture problems

- **Client detail page has no "Groups" tab.** `src/app/(app)/clients/[accountNumber]/page.tsx` has tabs for general info, loans, savings, charges, family/identity/documents, and notes, but nothing surfaces which group(s) a client belongs to, even though group membership is a first-class relationship in the data model (`GROUP }o--o{ CLIENT` in `SYSTEM_AUDIT.md`'s entity map, and `src/app/api/groups/[id]/members`). An operator has to go the other direction (open the group, scan its member list) to answer "what groups is this client in?".
- **Loan detail page is siloed from its own client's other accounts.** `src/app/(app)/loans/[id]/page.tsx` fetches the client's *active savings accounts* only to populate a disbursement-destination dropdown (lines 78, 160-168) — it is never rendered to the user as a "this client's accounts" section, and the page does not query or show the client's *other loans* at all. Compare to `src/app/(app)/savings-accounts/[accountNumber]/page.tsx:122-129`, which does link back to the owning client/group.
- **Sub-resource single-item pages have inconsistent justification for existing as full pages.** `src/app/(app)/loans/[id]/charges/[chargeId]/page.tsx` is ~114 lines and just renders a 9-field `<dl>` — a full page navigation for what would fit in an expandable row or side panel. By contrast, `.../collateral/[collateralId]/page.tsx`, `.../documents/[documentId]/page.tsx`, `.../transactions/[transactionId]/page.tsx`, and `.../servicing/[requestId]/page.tsx` carry genuinely page-worthy content (nested documents/notes panels, inline image preview, transaction allocation tables with reversal cross-links, decision workflows) and are reasonably justified as their own routes.
- **Reports are organized into 5 subject folders (`accounting`, `operations`, `risk`, `savings`, `insights`) plus a flat `client-statement`**, which is a sensible taxonomy, but because each report page is an independent implementation (see §3/§7), the *navigation* is fine while the *content shell* underneath it is not information-architected at all — every report re-decides its own filter layout and column order from scratch.

---

## 6. Component/architecture duplication

- **No shared UI primitives layer exists.** Confirmed: `src/components/` is a flat directory of 44 feature-specific files, no `ui/` subfolder, and `package.json` has no table/dialog/form-library dependency. `<table>` appears raw in 59 files project-wide; `<dialog>` appears raw in 5 files, each with its own `useRef<HTMLDialogElement>` open/close wiring (`disburse-loan-button.tsx`, `record-payment-button.tsx`, `reverse-disbursement-button.tsx`, `loan-service-actions-panel.tsx`, `new-savings-account-wizard.tsx`).
- **`loan-charge-panel.tsx` / `loan-collateral-panel.tsx`** — see §3, near-identical panel components that should be one generic component.
- **`collected-today`/`disbursed-today`/`due-today` pages** — see §3/§2, near-total duplication.
- **~30 report pages** duplicate filter/table/export scaffolding — see §3/§7.
- **Empty-state markup is duplicated as inline JSX** (`<div className="empty-state"><Icon/><strong/>...<p/></div>`) in essentially every list/tab across clients, groups, loans, savings, reports, rather than being a single `<EmptyState icon title description action/>` component — confirmed present with this exact shape in `src/app/(app)/clients/page.tsx`, `src/app/(app)/groups/page.tsx`, `src/app/(app)/loans/page.tsx`, `src/app/(app)/savings-accounts/page.tsx`, and the loan detail sub-tabs. A `compact-empty` CSS variant (used on loan-detail sub-tabs, e.g. the charges tab) additionally drops the icon that the full-page variants keep, so the pattern isn't even visually consistent where it *is* reused.
- **Investor/client-portal areas are appropriately isolated**, not duplicative: `src/app/portal/layout.tsx` and `src/app/investor/**` build their own header/shell and components (`portal-sign-out-button.tsx`, `investor-board.tsx`, `investor-invite-form.tsx`, etc.) rather than importing `AppSidebar`/`AppHeader`, which is correct given they serve a different user type (client/investor, not operator) — flagged here only so it's clear this separation was checked and is *not* a defect.

---

## 7. Workflow friction

- **Good: applying for a loan from a client's profile does not re-ask for client identity.** `ApplyForLoanButton` on the client page links to `/loans/new?clientId=…` (`src/components/client-account-panel.tsx:216`), and `src/app/(app)/loans/new/page.tsx:24,33` uses that `clientId` to pre-select the client server-side; `CreateLoanApplicationForm` only asks for loan-specific fields (product, officer, fund, terms, charges, collateral), never re-asking name/office/mobile that's already on the client record.
- **Good: opening a new savings account from a client's profile reuses `clientId` context.** `NewSavingsAccountWizard` takes `clientId` as a prop (`src/components/new-savings-account-wizard.tsx:17`) and posts to `/api/clients/${clientId}/savings-accounts` — no client fields are re-entered.
- **Friction: recording a loan repayment has two competing entry points.** `RecordPaymentButton` (a header modal, wired at `src/app/(app)/loans/[id]/page.tsx:218-224`) and an embedded "Record Payment" tab (same file, lines 254-276, `activeTab === "record-payment"`) both exist on the loan detail page simultaneously, rendering essentially the same `RepaymentForm`. A first-time user has no way to know which is "the" way to record a payment.
- **Friction: the disbursement form has a validation state bug**, not just a UX inconsistency — see §2 item 5 (`disburse-loan-form.tsx`, missing `setPending(false)` on the settlement-account-missing validation branch).
- **Friction: sub-actions on the client detail page mix interaction models inconsistently.** Family member / identifier / document / note adds are inline forms on the page itself (`src/components/client-record-forms.tsx`, wired at `src/app/(app)/clients/[accountNumber]/page.tsx:238,247,256,264`) — good, contextual, no navigation. But "Edit" and "Transfer client" force full-page navigation (`.../edit`, `.../transfer`), while "Assign staff" is an inline form inside a dropdown menu (`src/components/client-actions-menu.tsx:71-81`). There's no clear rule for when an action gets a full page vs. an inline form vs. a menu-embedded form.
- **Friction: charges over-navigate.** Viewing a single loan charge's ~9 fields requires a full page load (`src/app/(app)/loans/[id]/charges/[chargeId]/page.tsx`) that then has to link back ("Back to charges") to return to the loan — this breaks the flow of working through a loan's charges list.

---

## 8. Consistency problems

- **`clientTypeCode` and `classificationCode` on client creation are free-text `<input>`s, not `<select>`s** (`src/components/create-client-form.tsx`, the `clientTypeCode`/`classificationCode` fields), unlike `genderCode` on the same form which is a constrained `<select>`. This risks free-text drift (e.g. "Business" vs "business" vs "BUSINESS") for fields that are almost certainly meant to be coded/enumerated, matching how the legacy system treated them as "coded selection" per `SYSTEM_AUDIT.md`'s field inventory.
- **Validation style is inconsistently strict across similar money-entry forms.** `approve-loan-form.tsx` and `repayment-form.tsx` each independently regex-validate a decimal amount (`/^\d+(\.\d{1,2})?$/`) rather than sharing one validator; `disburse-loan-form.tsx` instead validates presence of a settlement/savings destination with a different code path (and has the pending-reset bug noted in §2/§7).
- **Empty-state visual language differs by location**: full "empty-state" (with icon) on list pages (`clients/page.tsx`, `groups/page.tsx`, `loans/page.tsx`, `savings-accounts/page.tsx`) vs. "empty-state compact-empty" (no icon, tighter spacing) on loan-detail sub-tabs — same concept, two different presentations with no documented rule for which to use where.
- **No page in the audited scope handles a failed data fetch with a dedicated error UI.** All observed list/detail pages rely on Next.js's default `error.tsx`/notFound boundary rather than a contextual "couldn't load this" state; none showed a loading skeleton for server-rendered data either (acceptable for pure RSC pages, but notably absent even where client components subsequently fetch, e.g. the report pages' filter reloads).
- **Two "manage users" surfaces with divergent panel implementations** (`admin-users-panel.tsx` vs. `team-permissions-panel.tsx`) that don't share a row/table component with each other or with the rest of the app (see §6).
- **CSS class naming is ambiguous in places actually used in markup** — e.g. `form-row three` (`create-client-form.tsx`) and `entity-form compact-mapping` (used across `client-record-forms.tsx`, `loan-charge-panel.tsx`, `loan-collateral-panel.tsx`) read as ad hoc utility names rather than a documented convention; harmless today but a growing source of "what does this class actually guarantee" ambiguity as more forms are added.

---

## 9. Quick wins

1. **Delete `src/components/operations-nav.tsx`** — confirmed dead code, zero references outside its own file.
2. **Fix the `disburse-loan-form.tsx` pending-state bug** on the settlement-account-missing validation branch (reset `pending` to `false` before returning).
3. **Add a link from the loan detail page's borrower name to `/clients/{accountNumber}`**, and extend its breadcrumb from `Loans / {accountNumber}` to `Loans / {Client name} / {accountNumber}` (`src/app/(app)/loans/[id]/page.tsx:194-196,292-296`) — mirrors what `savings-accounts/[accountNumber]/page.tsx` already does correctly.
4. **Pick one of the two "Record Payment" entry points** on the loan detail page (header modal or tab) and remove the other (`src/app/(app)/loans/[id]/page.tsx:218-224` vs. `254-276`).
5. **Convert `clientTypeCode`/`classificationCode` on `create-client-form.tsx` from free-text inputs to `<select>`s** backed by the same coded-value source used elsewhere (matching the `genderCode` field on the same form).
6. **Add a "Groups" section/tab to the client detail page** showing the client's group memberships (data already exists per the group-member relationship; just not surfaced here).

---

## 10. Larger architectural improvements

1. **Choose one primary navigation system and remove the other.** Rendering `AppSidebar` and `AppHeader` together (`src/components/app-shell.tsx:36-44`) doubles the maintenance surface for every future nav change and gives users two different mental models for the same set of destinations. This is the single highest-leverage IA fix in the codebase.
2. **Build a minimal shared UI primitives layer**: a `<DataTable>` (columns/rows/onRowClick/emptyState), a `<Dialog>`/modal wrapper around the native `<dialog>` pattern already used 5 times, and a `<EmptyState icon title description action>` component. This single investment would eliminate most of the duplication cited in §3 and §6 in one pass.
3. **Build a `<ReportShell>` component** to collapse the ~30 independently-implemented report pages down to page-specific column/query definitions plus one shared shell for breadcrumbs, the existing `ReportPicker`, filter bar, table, and CSV export — the single biggest concentration of duplicated code in the app by page count.
4. **Extract a generic `<AttachedItemsPanel>`** to replace `loan-charge-panel.tsx` and `loan-collateral-panel.tsx`, parameterized by item shape, columns, and create/mutate handlers.
5. **Add symmetric cross-entity linking**: client ↔ loan, client ↔ group, so that any detail page for a related entity always offers a way back to (and a summary of) the owning client, the way `savings-accounts/[accountNumber]/page.tsx` already does.
6. **Introduce a small `useFormAction` hook** to formalize the pending/fetch/toast/refresh pattern that's currently hand-typed in nearly every form component — the pattern itself is good and consistent; only its repetition is the problem.

---

## 11. Priority: Critical → High → Medium → Low

**Critical**
- Disbursement form validation bug leaves the submit button stuck disabled after a failed check (`disburse-loan-form.tsx`) — §2.5, §7.
- Two full primary navigation systems (`AppSidebar` + `AppHeader`) rendered simultaneously, encoding the same routes independently (`app-shell.tsx:36-44`) — §2.1, §4.

**High**
- No shared `<DataTable>`/table component; markup duplicated across clients/groups/loan-applications lists — §3, §6.
- ~30 report pages each reimplement filter/table/CSV-export scaffolding with only a "jump to report" dropdown shared — §2.7, §3, §10.2.
- `loan-charge-panel.tsx` / `loan-collateral-panel.tsx` are near-duplicate components — §3, §6, §10.4.
- Loan detail page has no link back to its client and doesn't surface the client's other loans, asymmetric with the savings account detail page — §2.4, §5, §7.
- `collected-today`/`disbursed-today`/`due-today` pages are near-total duplicates — §2.6, §3.

**Medium**
- Client detail page has no "Groups" tab despite group membership being a real relationship — §5, §9.6.
- Duplicate "Record Payment" entry points (header modal + embedded tab) on the loan detail page — §7, §9.4.
- Loan charge detail (`charges/[chargeId]`) over-navigates for ~9 simple fields — §5, §7.
- `clientTypeCode`/`classificationCode` are free-text instead of coded selects — §8, §9.5.
- No dedicated error-state UI anywhere in the audited scope; all pages rely on the default Next.js error boundary — §8.
- `/admin/users` and `/settings/team` are two disconnected "manage users" surfaces with no cross-links — §4, §6, §8.
- Inconsistent empty-state styling (`empty-state` vs. `empty-state compact-empty`) — §8.

**Low**
- Dead `operations-nav.tsx` component — §2.2, §4, §9.1.
- `/backoffice/funds` sits one level deeper in nav than its sibling Products/Accounting links — §4.
- Ambiguous/undocumented CSS class naming conventions (`form-row three`, `compact-mapping`) — §8.
- Validation message specificity varies slightly across similar money-entry forms — §8.

---

*Report location: `docs/ux-architecture-audit.md` (unstaged, uncommitted — this file has not been added to git).*
