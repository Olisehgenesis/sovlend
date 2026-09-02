"use client";

import { Banknote, Building2, LoaderCircle, Save, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

type Account = { id: string; label: string; type: string };
type Product = { id: string; name: string; mapping: { principalReceivableAccountId: string; interestIncomeAccountId: string; feeIncomeAccountId: string | null; penaltyIncomeAccountId: string | null; writeOffExpenseAccountId: string | null; overpaymentLiabilityAccountId: string | null } | null };
type SettlementAccount = { id: string; name: string; type: string; provider: string | null; accountReference: string | null; ledgerAccountId: string; active: boolean };

const accountHelp = {
  principal: "Asset account debited when principal is disbursed and credited as principal is repaid.",
  interest: "Revenue account credited when the borrower pays interest.",
  fee: "Optional revenue account for loan fees collected through repayment.",
  penalty: "Optional revenue account for late-payment penalties.",
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
  if (field === "interest") return bestKeywordMatch(productName, candidates)?.id ?? findByLabel(candidates, "financial revenue from loan portfolio")?.id ?? "";
  if (field === "penalty") return bestKeywordMatch(productName, candidates)?.id ?? findByLabel(candidates, "penalty income")?.id ?? "";
  return "";
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
  return <div className="settlement-manager"><div className="panel-heading"><div><h2>Settlement accounts</h2><p>{accounts.length} account{accounts.length === 1 ? "" : "s"} available to transaction forms</p></div></div><div className="settlement-registry">{accounts.length === 0 ? <div className="empty-state compact-empty"><Smartphone size={26} /><strong>No settlement accounts</strong><p>Add the first cash, bank, Airtel Money, or MTN MoMo account.</p></div> : accounts.map((account) => <article key={account.id} className="settlement-card"><span className="settlement-icon">{typeIcon(account.type)}</span><span><strong>{account.name}</strong><small>{account.provider || account.type.replaceAll("_", " ")}{account.accountReference ? ` · ${account.accountReference}` : ""}</small></span><span className={`mapping-state ${account.active ? "ready" : "missing"}`}>{account.active ? "Active" : "Inactive"}</span></article>)}</div><form action={save} className="entity-form compact-mapping settlement-create"><fieldset><legend>Add settlement account</legend><p className="fieldset-intro">Each provider or bank account becomes a separate selectable subaccount for disbursements and repayments.</p><div className="form-row"><label>Account name<input name="name" placeholder="Airtel Money Collections" required /></label><label>Type<select name="type" defaultValue="MOBILE_MONEY"><option value="CASH">Cash drawer</option><option value="BANK">Bank account</option><option value="MOBILE_MONEY">Mobile money</option></select></label></div><div className="form-row"><label>Provider<input name="provider" placeholder="Airtel Money, MTN MoMo, Stanbic…" /></label><label>Account reference<input name="accountReference" placeholder="Masked number or internal reference" /></label></div><label>GL asset subaccount<select name="ledgerAccountId" required defaultValue=""><option value="" disabled>Select verified asset account</option>{assetAccounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}</select><small className="field-help">Transactions through this provider debit or credit the selected ledger subaccount.</small></label></fieldset><div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} Add settlement account</button></div></form></div>;
}

export function ProductMappingForm({ product, accounts }: { product: Product; accounts: Account[] }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const options = (type: string) => accounts.filter((account) => account.type === type);
  async function save(formData: FormData) {
    setPending(true);
    const nullable = (name: string) => String(formData.get(name) || "") || null;
    const response = await fetch("/api/accounting/product-mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: product.id, principalReceivableAccountId: formData.get("principal"), interestIncomeAccountId: formData.get("interest"), feeIncomeAccountId: nullable("fee"), penaltyIncomeAccountId: nullable("penalty"), writeOffExpenseAccountId: nullable("writeOff"), overpaymentLiabilityAccountId: nullable("overpayment") }) });
    const result = await response.json(); setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Mapping could not be saved"); return; }
    toast.success(`${product.name} mapping saved`); router.refresh();
  }
  const select = (name: keyof typeof accountHelp, label: string, type: string, value?: string | null, required = false) => {
    const candidates = options(type);
    const suggestion = value ? null : suggestAccountId(name, product.name, candidates);
    return <label><span>{label}{required ? <b className="required-mark">Required</b> : <b className="optional-mark">Optional</b>}</span><select name={name} defaultValue={value ?? suggestion ?? ""} required={required}><option value="">Not configured</option>{candidates.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}</select><small className="field-help">{suggestion ? "Suggested default — review before saving. " : ""}{accountHelp[name]}</small></label>;
  };
  return <details className="mapping-product" open={!product.mapping}><summary><span><strong>{product.name}</strong><small>{product.mapping ? "Ready for mapped transactions" : "Required before disbursement"}</small></span><span className={`mapping-state ${product.mapping ? "ready" : "missing"}`}>{product.mapping ? "Configured" : "Incomplete"}</span></summary><form action={save} className="entity-form compact-mapping"><div className="form-row">{select("principal", "Principal receivable", "ASSET", product.mapping?.principalReceivableAccountId, true)}{select("interest", "Interest income", "REVENUE", product.mapping?.interestIncomeAccountId, true)}</div><div className="form-row three">{select("fee", "Fee income", "REVENUE", product.mapping?.feeIncomeAccountId)}{select("penalty", "Penalty income", "REVENUE", product.mapping?.penaltyIncomeAccountId)}{select("writeOff", "Write-off expense", "EXPENSE", product.mapping?.writeOffExpenseAccountId)}</div>{select("overpayment", "Overpayment liability", "LIABILITY", product.mapping?.overpaymentLiabilityAccountId)}<div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} Save product mapping</button></div></form></details>;
}