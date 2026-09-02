"use client";

import { CircleDollarSign, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

type ClientOption = { id: string; name: string; accountNumber: string };
type ProductOption = { id: string; name: string; currency: string; minimum: string; maximum: string };

export function CreateLoanApplicationForm({ clients, products, selectedClientId }: { clients: ClientOption[]; products: ProductOption[]; selectedClientId?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function createApplication(formData: FormData) {
    setPending(true);
    const amount = String(formData.get("amount"));
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
      toast.error("Enter a valid loan amount");
      setPending(false);
      return;
    }
    const [whole, fraction = ""] = amount.split(".");
    const proposedPrincipalMinor = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
    const response = await fetch("/api/loan-applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: formData.get("clientId"), productId: formData.get("productId"), proposedPrincipalMinor, purpose: formData.get("purpose") || undefined }) });
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Loan application could not be created");
      return;
    }
    toast.success("Loan application submitted for approval");
    router.push("/loans");
    router.refresh();
  }

  return <form action={createApplication} className="entity-form"><fieldset><legend>Borrower and product</legend><label>Client<select name="clientId" defaultValue={selectedClientId ?? ""} required><option value="" disabled>Select active client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.accountNumber}</option>)}</select></label><label>Loan product<select name="productId" required defaultValue=""><option value="" disabled>Select product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.currency} {product.minimum} to {product.maximum}</option>)}</select></label></fieldset><fieldset><legend>Application terms</legend><label>Requested principal (UGX)<input name="amount" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" required /></label><label>Loan purpose<textarea name="purpose" rows={4} /></label></fieldset><div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={18} /> : <CircleDollarSign size={18} />} Submit loan application</button></div></form>;
}