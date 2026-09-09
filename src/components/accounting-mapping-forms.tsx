"use client";

import { Banknote, Building2, LoaderCircle, Save, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";

type Account = { id: string; label: string; type: string };
type SavingsDefaults = { savingsLiabilityAccountId: string | null } | null;
type Product = {
  id: string;
  name: string;
  mapping: {
    principalReceivableAccountId: string;
    interestIncomeAccountId: string;
    feeIncomeAccountId: string | null;
    monitoringFeeIncomeAccountId: string | null;
    processingFeeIncomeAccountId: string | null;
    admissionFeeIncomeAccountId: string | null;
    penaltyIncomeAccountId: string | null;
    penaltyReceivableAccountId: string | null;
    writeOffExpenseAccountId: string | null;
    overpaymentLiabilityAccountId: string | null;
  } | null;
};
type SettlementAccount = { id: string; name: string; type: string; provider: string | null; accountReference: string | null; ledgerAccountId: string; active: boolean };

const accountHelp = {
  principal: "Asset account debited when principal is disbursed and credited as principal is repaid.",
  interest: "Revenue account credited when the borrower pays interest.",
  fee: "Optional revenue account for loan fees collected through repayment.",
  monitoringFee: "Optional dedicated revenue account for monitoring fees collected through repayment. Falls back to Fee income account if not set.",
  processingFee: "Optional dedicated revenue account for processing fees at disbursement. Falls back to Fee income account if not set.",
  admissionFee: "Optional dedicated revenue account for admission fees at disbursement. Falls back to Fee income account if not set.",
  penalty: "Optional revenue account for late-payment penalties.",
  penaltyReceivable: "Optional asset account used for accrued penalties before cash collection. Required before penalty accrual can be enabled for this product.",
  writeOff: "Optional expense account used when principal is approved for write-off.",
  overpayment: "Optional liability account holding money paid beyond the scheduled balance.",
};

const MAPPING_STOP_WORDS = new Set(["loan", "loans", "product", "income", "interest", "penalty", "fee", "the", "a", "of", "and"]);

function significantTokens(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((token) => token && !MAPPING_STOP_WORDS.has(token));
}

// Finds the account whose name shares the most keywords with the product name (e.g. "16 Weeks Loans" -> "16 Weeks Interest Income").
function bestKeywordMatch(productName: string, candidates: Account[]): Account | null {
  const productTokens = significantTokens(productName);
  if (productTokens.length === 0) return null;
  let best: { account: Account; score: number } | null = null;
  for (const account of candidates) {
    const accountTokens = new Set(significantTokens(account.label));
    const score = productTokens.filter((token) => accountTokens.has(token)).length;
    if (score > 0 && (!best || score > best.score)) best = { account, score };
  }
  return best?.account ?? null;
}

const findByLabel = (candidates: Account[], needle: string) => candidates.find((account) => account.label.toLowerCase().includes(needle));

// Suggests a default account so new products aren't left "Not configured" — always reviewable/overridable before saving.
function suggestAccountId(field: keyof typeof accountHelp, productName: string, candidates: Account[]): string {
  if (field === "principal") return findByLabel(candidates, "loan receivable")?.id ?? "";
  if (field === "writeOff") return findByLabel(candidates, "written off")?.id ?? "";
  if (field === "overpayment") return findByLabel(candidates, "overpayment")?.id ?? "";
  if (field === "fee") return findByLabel(candidates, "fee income")?.id ?? "";
  if (field === "monitoringFee") return findByLabel(candidates, "monitoring")?.id ?? findByLabel(candidates, "fee income")?.id ?? "";
  if (field === "processingFee") return findByLabel(candidates, "processing")?.id ?? findByLabel(candidates, "fee income")?.id ?? "";
  if (field === "admissionFee") return findByLabel(candidates, "admission")?.id ?? findByLabel(candidates, "fee income")?.id ?? "";
  if (field === "interest") return bestKeywordMatch(productName, candidates)?.id ?? findByLabel(candidates, "financial revenue from loan portfolio")?.id ?? "";
  if (field === "penalty") return bestKeywordMatch(productName, candidates)?.id ?? findByLabel(candidates, "penalty income")?.id ?? "";
  if (field === "penaltyReceivable") return findByLabel(candidates, "penalties receivable")?.id ?? findByLabel(candidates, "penalty receivable")?.id ?? bestKeywordMatch(`${productName} penalty`, candidates)?.id ?? "";
  return "";
}

export function SavingsDefaultsForm({
  organizationId,
  liabilityAccounts,
  defaults,
}: {
  organizationId: string;
  liabilityAccounts: Account[];
  defaults: SavingsDefaults;
}) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function save(formData: FormData) {
    setPending(true);
    const response = await fetch("/api/accounting/savings-defaults", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        savingsLiabilityAccountId: formData.get("savingsLiabilityAccountId"),
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Savings default could not be saved");
      return;
    }
    toast.success("Savings default saved");
    router.refresh();
  }

  return (
    <form action={save} className="entity-form compact-mapping">
      <fieldset>
        <legend>Organization savings default</legend>
        <p className="fieldset-intro">
          Choose the fallback liability account credited on deposits and debited on withdrawals when a savings product has no dedicated override.
        </p>
        <label>
          <span>
            Savings liability account
            <b className="required-mark">Required</b>
          </span>
          <select
            defaultValue={defaults?.savingsLiabilityAccountId ?? ""}
            name="savingsLiabilityAccountId"
            required
          >
            <option value="" disabled>
              Select verified liability account
            </option>
            {liabilityAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </select>
          <small className="field-help">
            This org-wide fallback is used before the legacy hardcoded GL-code table whenever a savings
            product does not have its own accounting mapping.
          </small>
        </label>
      </fieldset>
      <div className="form-actions">
        <BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} type="submit">
          Save savings
          default
        </BrandActionButton>
      </div>
    </form>
  );
}

export function SettlementMappingForm({ organizationId, assetAccounts, accounts }: { organizationId: string; assetAccounts: Account[]; accounts: SettlementAccount[] }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();
  async function save(formData: FormData) {
    setPending(true);
    const response = await fetch("/api/accounting/settlement-mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId, name: formData.get("name"), type: formData.get("type"), provider: formData.get("provider") || undefined, accountReference: formData.get("accountReference") || undefined, currencyCode: "UGX", ledgerAccountId: formData.get("ledgerAccountId"), active: true }) });
    const result = await response.json();
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Settlement account could not be added"); return; }
    toast.success("Settlement account added"); router.refresh();
  }
  const typeIcon = (type: string) => type === "CASH" ? <Banknote size={18} /> : type === "BANK" ? <Building2 size={18} /> : <Smartphone size={18} />;
  return <div className="settlement-manager"><div className="panel-heading"><div><h2>Settlement accounts</h2><p>{accounts.length} account{accounts.length === 1 ? "" : "s"} available to transaction forms</p></div></div><div className="settlement-registry">{accounts.length === 0 ? <div className="empty-state compact-empty"><Smartphone size={26} /><strong>No settlement accounts</strong><p>Add the first cash, bank, Airtel Money, or MTN MoMo account.</p></div> : accounts.map((account) => <article key={account.id} className="settlement-card"><span className="settlement-icon">{typeIcon(account.type)}</span><span><strong>{account.name}</strong><small>{account.provider || account.type.replaceAll("_", " ")}{account.accountReference ? ` · ${account.accountReference}` : ""}</small></span><span className={`mapping-state ${account.active ? "ready" : "missing"}`}>{account.active ? "Active" : "Inactive"}</span></article>)}</div><form action={save} className="entity-form compact-mapping settlement-create"><fieldset><legend>Add settlement account</legend><p className="fieldset-intro">Each provider or bank account becomes a separate selectable subaccount for disbursements and repayments.</p><div className="form-row"><label>Account name<input name="name" placeholder="Airtel Money Collections" required /></label><label>Type<select name="type" defaultValue="MOBILE_MONEY"><option value="CASH">Cash drawer</option><option value="BANK">Bank account</option><option value="MOBILE_MONEY">Mobile money</option></select></label></div><div className="form-row"><label>Provider<input name="provider" placeholder="Airtel Money, MTN MoMo, Stanbic…" /></label><label>Account reference<input name="accountReference" placeholder="Masked number or internal reference" /></label></div><label>GL asset subaccount<select name="ledgerAccountId" required defaultValue=""><option value="" disabled>Select verified asset account</option>{assetAccounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}</select><small className="field-help">Transactions through this provider debit or credit the selected ledger subaccount.</small></label></fieldset><div className="form-actions"><BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} type="submit">Add settlement account</BrandActionButton></div></form></div>;
}

const ACCOUNT_TYPES = [
  { value: "ASSET", label: "Asset" },
  { value: "LIABILITY", label: "Liability" },
  { value: "EQUITY", label: "Equity" },
  { value: "REVENUE", label: "Revenue (income)" },
  { value: "EXPENSE", label: "Expense" },
] as const;

export function CreateLedgerAccountForm({ currencyCodes }: { currencyCodes: string[] }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function create(formData: FormData) {
    setPending(true);
    const response = await fetch("/api/accounting/ledger-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: formData.get("code"),
        name: formData.get("name"),
        type: formData.get("type"),
        currencyCode: formData.get("currencyCode"),
        usage: formData.get("usage"),
        description: formData.get("description") || undefined,
        manualEntriesAllowed: formData.get("manualEntriesAllowed") === "on",
        active: true,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Account could not be created");
      return;
    }
    toast.success("Account created");
    router.refresh();
  }

  return (
    <form action={create} className="entity-form compact-mapping">
      <fieldset>
        <legend>Create GL account</legend>
        <p className="fieldset-intro">Add a new entry to the chart of accounts. Codes and currency must be unique together.</p>
        <div className="form-row">
          <label>
            Code
            <input name="code" placeholder="e.g. 60010" required />
          </label>
          <label>
            Type
            <select name="type" defaultValue="EXPENSE" required>
              {ACCOUNT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Name
          <input name="name" placeholder="e.g. Office Rent Expense" required />
        </label>
        <div className="form-row">
          <label>
            Currency
            <select name="currencyCode" defaultValue={currencyCodes[0] ?? "UGX"} required>
              {currencyCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Usage
            <select name="usage" defaultValue="DETAIL">
              <option value="DETAIL">Detail (postable)</option>
              <option value="HEADER">Header (grouping only)</option>
            </select>
          </label>
        </div>
        <label>
          Description (optional)
          <input name="description" maxLength={300} />
        </label>
        <label className="check-row">
          <input name="manualEntriesAllowed" type="checkbox" defaultChecked />
          Allow manual journal entries (income/expense recording)
        </label>
      </fieldset>
      <div className="form-actions">
        <BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} type="submit">
          Create account
        </BrandActionButton>
      </div>
    </form>
  );
}

export function ProductMappingForm({ product, accounts }: { product: Product; accounts: Account[] }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const options = (type: string) => accounts.filter((account) => account.type === type);
  async function save(formData: FormData) {
    setPending(true);
    const nullable = (name: string) => String(formData.get(name) || "") || null;
    const response = await fetch("/api/accounting/product-mappings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: product.id, principalReceivableAccountId: formData.get("principal"), interestIncomeAccountId: formData.get("interest"), feeIncomeAccountId: nullable("fee"), monitoringFeeIncomeAccountId: nullable("monitoringFee"), processingFeeIncomeAccountId: nullable("processingFee"), admissionFeeIncomeAccountId: nullable("admissionFee"), penaltyIncomeAccountId: nullable("penalty"), penaltyReceivableAccountId: nullable("penaltyReceivable"), writeOffExpenseAccountId: nullable("writeOff"), overpaymentLiabilityAccountId: nullable("overpayment") }) });
    const result = await response.json(); setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Mapping could not be saved"); return; }
    toast.success(`${product.name} mapping saved`); router.refresh();
  }
  const select = (name: keyof typeof accountHelp, label: string, type: string, value?: string | null, required = false) => {
    const candidates = options(type);
    const suggestion = value ? null : suggestAccountId(name, product.name, candidates);
    return <label><span>{label}{required ? <b className="required-mark">Required</b> : <b className="optional-mark">Optional</b>}</span><select name={name} defaultValue={value ?? suggestion ?? ""} required={required}><option value="">Not configured</option>{candidates.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}</select><small className="field-help">{suggestion ? "Suggested default — review before saving. " : ""}{accountHelp[name]}</small></label>;
  };
  return <details className="mapping-product" open={!product.mapping}><summary><span><strong>{product.name}</strong><small>{product.mapping ? "Ready for mapped transactions" : "Required before disbursement"}</small></span><span className={`mapping-state ${product.mapping ? "ready" : "missing"}`}>{product.mapping ? "Configured" : "Incomplete"}</span></summary><form action={save} className="entity-form compact-mapping"><div className="form-row">{select("principal", "Principal receivable", "ASSET", product.mapping?.principalReceivableAccountId, true)}{select("interest", "Interest income", "REVENUE", product.mapping?.interestIncomeAccountId, true)}</div><div className="form-row three">{select("fee", "Fee income", "REVENUE", product.mapping?.feeIncomeAccountId)}{select("monitoringFee", "Monitoring fee income", "REVENUE", product.mapping?.monitoringFeeIncomeAccountId)}{select("penalty", "Penalty income", "REVENUE", product.mapping?.penaltyIncomeAccountId)}</div><div className="form-row three">{select("processingFee", "Processing fee income", "REVENUE", product.mapping?.processingFeeIncomeAccountId)}{select("admissionFee", "Admission fee income", "REVENUE", product.mapping?.admissionFeeIncomeAccountId)}{select("penaltyReceivable", "Penalty receivable", "ASSET", product.mapping?.penaltyReceivableAccountId)}</div><div className="form-row">{select("writeOff", "Write-off expense", "EXPENSE", product.mapping?.writeOffExpenseAccountId)}{select("overpayment", "Overpayment liability", "LIABILITY", product.mapping?.overpaymentLiabilityAccountId)}</div><div className="form-actions"><BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} type="submit">Save product mapping</BrandActionButton></div></form></details>;
}