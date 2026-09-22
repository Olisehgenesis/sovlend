import type { UserRole } from "@prisma/client";

export type RolePlaybookId =
  | "teller"
  | "loan-officer"
  | "branch-manager"
  | "general-manager"
  | "treasury-signer"
  | "auditor"
  | "investor";

export type RoleHowTo = Readonly<{
  title: string;
  intro?: string;
  steps: readonly string[];
  note?: string;
}>;

export type RoleAction = Readonly<{
  title: string;
  description: string;
  href?: string;
}>;

export type RolePlaybook = Readonly<{
  id: RolePlaybookId;
  label: string;
  summary: string;
  howTos: readonly RoleHowTo[];
  actions: readonly RoleAction[];
}>;

export const rolePlaybooks: readonly RolePlaybook[] = [
  {
    id: "teller",
    label: "Teller",
    summary: "Collect cash, post repayments, and handle savings deposits and withdrawals. You do not originate or disburse loans.",
    howTos: [
      {
        title: "How do I record charges while disbursing a loan?",
        intro: "You do not type the fee on the Disburse form. Disburse only pays out. Charges must already sit on the loan, with no due date. At disbursement those fees are taken off the principal automatically, and the client’s savings is credited the net amount.",
        steps: [
          "A teller cannot add charges or disburse on the default Teller role. Ask the loan officer or branch manager to attach the fee first.",
          "Loan officer path: Loans → New application → Charges step. Tick processing, insurance, or other loan fees, then submit. After approval those charges land on the loan with a blank due date.",
          "Last-minute path: open the approved loan → Charges tab → Add loan charge. Pick the charge type. Leave Due date empty. Empty due date means “take this at disbursement.”",
          "Branch manager (or anyone with disbursement permission) opens the same loan and clicks Disburse. Principal minus those pending charges is credited to the client’s savings account. The charges are marked paid.",
          "If the client wants cash, you withdraw the net proceeds from their savings account after disbursement.",
        ],
        note: "If you fill in a due date, the charge stays outstanding after payout and is collected later with a repayment — it is not deducted at disbursement.",
      },
      {
        title: "How do I record a loan repayment?",
        intro: "Use the loan account, not a journal entry.",
        steps: [
          "Find the loan from Loans → All active loans, or search the client.",
          "Open the loan and go to Record payment.",
          "Enter the amount received, the cash/bank/mobile-money account it went into, and the business date.",
          "Submit. The receipt splits across principal, interest, fees, and penalties automatically.",
        ],
      },
      {
        title: "How do I take a savings deposit or pay a withdrawal?",
        steps: [
          "Open the client, then the savings account.",
          "Use Deposit or Withdraw. Choose the settlement account that matches the cash or mobile-money drawer.",
          "Loan proceeds already sit in savings after disbursement — a cash payout is a withdrawal, not a second disbursement.",
        ],
      },
    ],
    actions: [
      { title: "Search a client", description: "Look up a client, loan, or savings account from the top search bar.", href: "/clients" },
      { title: "Record a repayment", description: "Post a receipt against an active loan.", href: "/loans" },
      { title: "Savings deposit or withdrawal", description: "Move cash in or out of a savings account.", href: "/savings-accounts" },
      { title: "Print a client statement", description: "Open Reports → Client statement for a printable ledger of loans, savings, and charges.", href: "/reports/client-statement" },
    ],
  },
  {
    id: "loan-officer",
    label: "Loan officer",
    summary: "Own the client file and the application. You attach disbursement charges when you originate the loan — you do not click Disburse.",
    howTos: [
      {
        title: "How do I record charges that should be taken at disbursement?",
        intro: "Tick them on the application. Do not wait for the teller window.",
        steps: [
          "Go to Loans → New application.",
          "Fill Details and Terms, then open the Charges step.",
          "Tick every fee that should come off the payout (processing fee, insurance, and so on).",
          "Submit. After a manager approves, those charges are copied onto the loan with no due date.",
          "When the loan is disbursed, the system nets those pending charges against principal and credits savings with the remainder.",
        ],
        note: "To add a fee after approval, open the loan → Charges → Add loan charge and leave Due date empty, then ask the branch to disburse.",
      },
      {
        title: "How do I start a loan?",
        steps: [
          "Confirm the client is active and has an active savings account in the same currency — disbursement always credits savings.",
          "Loans → New application. Choose the borrower, product, officer, and amount.",
          "On Charges, select fees due at payout.",
          "Submit. The application waits in Submitted until a manager approves.",
        ],
      },
    ],
    actions: [
      { title: "Add or update a client", description: "Create the client record and keep KYC current.", href: "/clients/new" },
      { title: "New loan application", description: "Originate a loan and attach disbursement charges.", href: "/loans/new" },
      { title: "Follow submitted applications", description: "See files waiting for review.", href: "/loans/applications?status=SUBMITTED" },
      { title: "Active loans", description: "View loans already on the books.", href: "/loans" },
    ],
  },
  {
    id: "branch-manager",
    label: "Branch manager",
    summary: "Approve, disburse, and unblock the branch. You are the person who actually pays a loan out.",
    howTos: [
      {
        title: "How do I record charges while disbursing a loan?",
        intro: "Attach the charges on the loan first, then disburse. The Disburse form has no fee field.",
        steps: [
          "Open Loans → Active applications (awaiting disbursement), or the approved loan.",
          "Go to the Charges tab. Confirm processing and other payout fees are listed as PENDING with a blank due date.",
          "Missing a fee? Charges → Add loan charge. Pick the catalog item (or a custom charge). Leave Due date empty. Add charge.",
          "Click Disburse loan. Choose the client’s savings account and payment method. Submit.",
          "The journal credits savings with principal minus those charges, and marks the charges paid. Tell the teller the client can withdraw cash from savings if they want notes in hand.",
        ],
        note: "A charge with a due date is not taken at payout. It stays due and is collected with a later repayment.",
      },
      {
        title: "How do I approve and pay a loan?",
        steps: [
          "Loans → Submitted (needs review). Open the application and approve within your limit.",
          "Confirm the borrower has an active savings account.",
          "On the approved loan, Disburse. Net proceeds always go to savings.",
        ],
      },
    ],
    actions: [
      { title: "Review applications", description: "Approve or send back submitted files.", href: "/loans/applications?status=SUBMITTED" },
      { title: "Disburse approved loans", description: "Pay out loans waiting for disbursement.", href: "/loans/applications?status=APPROVED" },
      { title: "Add a loan charge", description: "Open any loan → Charges to attach a fee before or after payout.", href: "/loans" },
      { title: "Approve investor access", description: "Grant or reject investor requests for this organization.", href: "/backoffice/investors" },
    ],
  },
  {
    id: "general-manager",
    label: "General manager",
    summary: "Organization-wide operations: approvals, disbursement, accounting, products, and access — except treasury dual-control sign-off.",
    howTos: [
      {
        title: "How do I record charges while disbursing a loan?",
        intro: "Same as branch: charges live on the loan, then Disburse nets them.",
        steps: [
          "Open the approved loan → Charges. Add any missing fee with a blank due date.",
          "Disburse. Savings is credited net of those pending charges.",
          "Use Accounting if you need a journal that is not a loan fee (donations, office expense).",
        ],
      },
    ],
    actions: [
      { title: "Approve and disburse", description: "Full loan lifecycle across offices.", href: "/loans/applications" },
      { title: "Record income or expense", description: "Post a manual receipt or payment to the ledger.", href: "/backoffice/accounting/income" },
      { title: "Journal entries", description: "Add a balanced general journal.", href: "/backoffice/accounting/journal-entries" },
      { title: "Users and permissions", description: "Grant a teller extra rights only if they should disburse or add charges.", href: "/settings/team" },
    ],
  },
  {
    id: "treasury-signer",
    label: "Treasury signer",
    summary: "Second signature on treasury movements. You view positions and accounting reports; you do not run the teller window.",
    howTos: [
      {
        title: "How do I approve a treasury movement?",
        steps: [
          "Open the treasury proposal waiting for a second signer.",
          "Check amount, destination, and supporting reference.",
          "Approve or reject. You cannot be the same person who proposed the movement.",
        ],
      },
    ],
    actions: [
      { title: "View accounting reports", description: "Balance sheet, income statement, trial balance, and general ledger.", href: "/reports" },
      { title: "Outstanding balances", description: "Check OLB before signing a large movement.", href: "/reports/operations/outstanding-balances" },
    ],
  },
  {
    id: "auditor",
    label: "Auditor",
    summary: "Read-only across clients, loans, savings, treasury, and the ledger. You inspect; you do not post.",
    howTos: [
      {
        title: "How do I trace a disbursement and its charges?",
        steps: [
          "Open the loan. Charges tab shows fees taken at payout (status Paid, no due date) versus later dues.",
          "Transactions on the same loan show the disbursement.",
          "Reports → Journal reconciliation or General ledger to follow the accounting lines.",
          "Reports → Audit trail for who approved and who disbursed.",
        ],
      },
    ],
    actions: [
      { title: "Audit trail", description: "Search immutable activity.", href: "/reports/insights/audit-trail" },
      { title: "Journal reconciliation", description: "Find posted journals by date, office, or account.", href: "/reports/accounting/journal-reconciliation" },
      { title: "Fee revenue", description: "See income from charges.", href: "/reports/insights/fee-revenue" },
    ],
  },
  {
    id: "investor",
    label: "Investor",
    summary: "Fund and follow your position. You do not operate the branch, disburse loans, or post charges.",
    howTos: [
      {
        title: "How do I open my investor workspace?",
        steps: [
          "Use Investor portal from sign-in, not the staff workspace.",
          "If you are waiting on access, an organisation manager must approve your request first.",
        ],
      },
    ],
    actions: [
      { title: "Investor portal", description: "View commitments and fund the organisation you were granted.", href: "/investor" },
    ],
  },
];

const playbookById = new Map(rolePlaybooks.map((playbook) => [playbook.id, playbook]));

const roleToPlaybookId: Partial<Record<UserRole, RolePlaybookId>> = {
  TELLER: "teller",
  LOAN_OFFICER: "loan-officer",
  BRANCH_MANAGER: "branch-manager",
  GENERAL_MANAGER: "general-manager",
  TREASURY_SIGNER: "treasury-signer",
  AUDITOR: "auditor",
  INVESTOR: "investor",
};

export function getRolePlaybook(id: string | null | undefined): RolePlaybook {
  return playbookById.get(id as RolePlaybookId) ?? rolePlaybooks[0];
}

export function playbookIdForSystemRole(systemRole: UserRole | null | undefined): RolePlaybookId {
  return (systemRole ? roleToPlaybookId[systemRole] : undefined) ?? "teller";
}
