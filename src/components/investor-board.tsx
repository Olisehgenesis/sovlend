"use client";

import { Bitcoin, Building2, LoaderCircle, QrCode, TrendingUp } from "lucide-react";
import Image from "next/image";
import QRCode from "qrcode";
import { useState } from "react";
import { toast } from "sonner";

type Access = { id: string; organizationId: string; organizationName: string };
type Commitment = { id: string; organizationName: string; amount: string; sats: string; status: string; createdAt: string };
type Invoice = { bolt11: string; expiresAt: string; amountSats: string };

export function InvestorBoard({ investorName, accesses, commitments }: { investorName: string; accesses: Access[]; commitments: Commitment[] }) {
  const [pending, setPending] = useState(false);
  const [invoice, setInvoice] = useState<(Invoice & { qr: string }) | null>(null);

  async function invest(formData: FormData) {
    setPending(true);
    setInvoice(null);
    try {
      const currencyCode = String(formData.get("currencyCode")) as "UGX" | "USD";
      const amountMinor = parseMinor(String(formData.get("amount")), currencyCode);
      const response = await fetch("/api/investments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: formData.get("organizationId"), currencyCode, amountMinor, idempotencyKey: crypto.randomUUID() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Investment invoice could not be created");
      if (!payload.invoice) throw new Error("Invoice creation is still processing");
      const qr = await QRCode.toDataURL(payload.invoice.bolt11, { width: 360, margin: 2, errorCorrectionLevel: "M" });
      setInvoice({ ...payload.invoice, amountSats: payload.amountSats, qr });
      toast.success("Lightning invoice created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Investment could not be started");
    } finally {
      setPending(false);
    }
  }

  return <main className="investor-page"><header className="investor-header"><div><p className="eyebrow">Investor workspace</p><h1>{investorName}</h1><p>Fund approved businesses and track each contribution from invoice to settlement.</p></div><a className="security-link" href="/settings/security">Account security</a></header><section className="investor-grid"><article className="panel invest-panel"><div className="panel-heading"><div><h2>Make an investment</h2><p>A fresh rate is locked when the invoice is created.</p></div><Bitcoin size={19} /></div>{accesses.length === 0 ? <div className="empty-state"><Building2 size={28} /><strong>No approved businesses</strong><p>Request access before investing.</p><a className="green-link" href="/investor/request-access">Request access</a></div> : <form action={invest} className="stack-form"><label>Business<select name="organizationId" required>{accesses.map((access) => <option value={access.organizationId} key={access.id}>{access.organizationName}</option>)}</select></label><div className="amount-row"><label>Amount<input name="amount" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" required /></label><label>Currency<select name="currencyCode"><option value="UGX">UGX</option><option value="USD">USD</option></select></label></div><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={18} /> : <QrCode size={18} />} Create Lightning invoice</button></form>}</article>{invoice ? <article className="panel invoice-panel"><div className="panel-heading"><div><h2>Scan to invest</h2><p>{invoice.amountSats} sats · expires {new Date(invoice.expiresAt).toLocaleTimeString()}</p></div></div><Image src={invoice.qr} width={280} height={280} unoptimized alt="Lightning invoice QR code" /><code>{invoice.bolt11}</code><small>Keep this page open while payment confirms.</small></article> : <article className="panel invoice-placeholder"><QrCode size={34} /><strong>Your invoice will appear here</strong><p>Nothing is reserved until an invoice is generated.</p></article>}</section><section className="panel investment-history"><div className="panel-heading"><div><h2>Investment history</h2><p>All commitments linked to your account</p></div><TrendingUp size={19} /></div>{commitments.length === 0 ? <div className="empty-state"><TrendingUp size={28} /><strong>No investments yet</strong><p>Your first Lightning invoice and settlement will appear here.</p></div> : <div className="table-scroll"><table><thead><tr><th>Business</th><th>Contribution</th><th>Bitcoin</th><th>Status</th><th>Created</th></tr></thead><tbody>{commitments.map((item) => <tr key={item.id}><td><strong>{item.organizationName}</strong></td><td>{item.amount}</td><td>{item.sats} sats</td><td><span className={`status ${item.status === "FUNDED" ? "up-to-date" : "review"}`}>{item.status.replaceAll("_", " ")}</span></td><td>{new Date(item.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></div>}</section></main>;
}

function parseMinor(value: string, currency: "UGX" | "USD") {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error("Enter a valid positive amount");
  const [whole, fraction = ""] = value.split(".");
  return currency === "UGX" ? BigInt(whole).toString() : (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
}