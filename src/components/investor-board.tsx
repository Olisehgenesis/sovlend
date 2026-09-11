"use client";

import { Bitcoin, Building2, Clock3, LoaderCircle, QrCode, TrendingUp, Wallet } from "lucide-react";
import Image from "next/image";
import QRCode from "qrcode";
import { useState } from "react";
import { toast } from "sonner";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Access = { id: string; organizationId: string; organizationName: string };
type Commitment = { id: string; organizationName: string; amount: string; sats: string; status: string; createdAt: string };
type Invoice = { bolt11: string; expiresAt: string; amountSats: string };
type BtcExposure = {
  organizationId: string;
  organizationName: string;
  clientBtcSats: string;
  investorFundedSats: string;
  totalBtcSats: string;
  totalBtcValueFormatted: string | null;
  fiatPortfolioFormatted: string;
  fundsUnderManagementFormatted: string;
  btcExposurePercent: string;
};
type Portfolio = {
  memberSince: string;
  businessCount: number;
  fundedCount: number;
  fundedSats: string;
  pendingCount: number;
  pendingSats: string;
  fundedByCurrency: { currencyCode: string; formatted: string }[];
  timeline: { date: string; cumulativeSats: number }[];
};

export function InvestorBoard({ investorName, accesses, commitments, btcExposure, portfolio }: { investorName: string; accesses: Access[]; commitments: Commitment[]; btcExposure: BtcExposure[]; portfolio: Portfolio }) {
  const [pending, setPending] = useState(false);
  const [invoice, setInvoice] = useState<(Invoice & { qr: string }) | null>(null);
  const [rows, setRows] = useState(commitments);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  async function checkStatus(id: string) {
    setCheckingId(id);
    try {
      const response = await fetch(`/api/investments/${id}/check-status`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not check payment status");
      setRows((prev) => prev.map((row) => (row.id === id ? { ...row, status: payload.status } : row)));
      toast[payload.status === "AWAITING_PAYMENT" ? "message" : "success"](payload.status === "AWAITING_PAYMENT" ? "Still awaiting payment" : "Payment status updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not check payment status");
    } finally {
      setCheckingId(null);
    }
  }

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

  const memberSinceLabel = new Date(portfolio.memberSince).toLocaleDateString(undefined, { year: "numeric", month: "long" });

  return <main className="investor-page"><header className="investor-header"><div><p className="eyebrow">Investor workspace</p><h1>{investorName}</h1><p>Fund approved businesses and track each contribution from invoice to settlement.</p></div><a className="security-link" href="/settings/security">Account security</a></header>
    <section className="panel portfolio-overview">
      <div className="panel-heading"><div><h2>Your portfolio</h2><p>Deposits and investments across every business you back · investor since {memberSinceLabel}</p></div><Wallet size={19} /></div>
      <div className="kpi-row">
        <div className="kpi-card"><span className="kpi-label">Total deposited</span>{portfolio.fundedByCurrency.length === 0 ? <strong className="kpi-value">Nothing yet</strong> : portfolio.fundedByCurrency.map((entry) => <strong className="kpi-value" key={entry.currencyCode}>{entry.formatted}</strong>)}<span className="kpi-sub">{portfolio.fundedCount} settled deposit{portfolio.fundedCount === 1 ? "" : "s"}</span></div>
        <div className="kpi-card"><span className="kpi-label">Bitcoin funded</span><strong className="kpi-value">{satsLabel(portfolio.fundedSats)}</strong><span className="kpi-sub">across {portfolio.businessCount} business{portfolio.businessCount === 1 ? "" : "es"}</span></div>
        <div className="kpi-card"><span className="kpi-label">Awaiting settlement</span><strong className="kpi-value">{satsLabel(portfolio.pendingSats)}</strong><span className="kpi-sub">{portfolio.pendingCount} pending invoice{portfolio.pendingCount === 1 ? "" : "s"}</span></div>
      </div>
      {portfolio.timeline.length > 1 ? <div className="portfolio-chart"><ResponsiveContainer width="100%" height={180}><AreaChart data={portfolio.timeline}><CartesianGrid strokeDasharray="3 3" stroke="#e3ece6" /><XAxis dataKey="date" fontSize={11} stroke="#7c8b82" /><YAxis fontSize={11} stroke="#7c8b82" width={70} tickFormatter={(value: number) => value.toLocaleString()} /><            Tooltip formatter={(value: unknown) => [`${Number(value).toLocaleString()} sats`, "Cumulative funded"]} /><Area type="monotone" dataKey="cumulativeSats" stroke="#25814f" fill="#cfebd8" /></AreaChart></ResponsiveContainer></div> : <p className="chart-empty-note"><Clock3 size={14} /> A growth chart appears once you have two or more settled deposits.</p>}    </section>    <section className="investor-grid"><article className="panel invest-panel"><div className="panel-heading"><div><h2>Make an investment</h2><p>A fresh rate is locked when the invoice is created.</p></div><Bitcoin size={19} /></div>{accesses.length === 0 ? <div className="empty-state"><Building2 size={28} /><strong>No approved businesses</strong><p>Request access before investing.</p><a className="green-link" href="/investor/request-access">Request access</a></div> : <form action={invest} className="stack-form"><label>Business<select name="organizationId" required>{accesses.map((access) => <option value={access.organizationId} key={access.id}>{access.organizationName}</option>)}</select></label><div className="amount-row"><label>Amount<input name="amount" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" required /></label><label>Currency<select name="currencyCode"><option value="UGX">UGX</option><option value="USD">USD</option></select></label></div><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={18} /> : <QrCode size={18} />} Create Lightning invoice</button></form>}</article>{invoice ? <article className="panel invoice-panel"><div className="panel-heading"><div><h2>Scan to invest</h2><p>{invoice.amountSats} sats · expires {new Date(invoice.expiresAt).toLocaleTimeString()}</p></div></div><Image src={invoice.qr} width={280} height={280} unoptimized alt="Lightning invoice QR code" /><code>{invoice.bolt11}</code><small>Keep this page open while payment confirms.</small></article> : <article className="panel invoice-placeholder"><QrCode size={34} /><strong>Your invoice will appear here</strong><p>Nothing is reserved until an invoice is generated.</p></article>  }</section>{btcExposure.length > 0 ? <section className="panel btc-exposure"><div className="panel-heading"><div><h2>Bitcoin exposure</h2><p>Read-only summary -- SovLend does not move funds here (Phase 1 custody design)</p></div><Bitcoin size={19} /></div><div className="table-scroll"><table><thead><tr><th>Business</th><th>Client BTC held</th><th>Your funded BTC</th><th>Total BTC value</th><th>Fiat portfolio</th><th>Funds under management</th><th>BTC exposure</th></tr></thead><tbody>{btcExposure.map((item) => <tr key={item.organizationId}><td><strong>{item.organizationName}</strong></td><td>{satsLabel(item.clientBtcSats)}</td><td>{satsLabel(item.investorFundedSats)}</td><td>{item.totalBtcValueFormatted ?? <span className="muted-text">Price unavailable</span>}</td><td>{item.fiatPortfolioFormatted}</td><td>{item.fundsUnderManagementFormatted}</td><td>{item.btcExposurePercent}%</td></tr>)}</tbody></table></div></section> : null}<section className="panel investment-history"><div className="panel-heading"><div><h2>Investment history</h2><p>All commitments linked to your account</p></div><TrendingUp size={19} /></div>{commitments.length === 0 ? <div className="empty-state"><TrendingUp size={28} /><strong>No investments yet</strong><p>Your first Lightning invoice and settlement will appear here.</p></div> : <div className="table-scroll"><table><thead><tr><th>Business</th><th>Contribution</th><th>Bitcoin</th><th>Status</th><th>Created</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td><strong>{item.organizationName}</strong></td><td>{item.amount}</td><td>{item.sats} sats</td><td><span className={`status ${item.status === "FUNDED" ? "up-to-date" : "review"}`}>{item.status.replaceAll("_", " ")}</span>{item.status === "AWAITING_PAYMENT" ? <button type="button" className="check-status-button" disabled={checkingId === item.id} onClick={() => checkStatus(item.id)}>{checkingId === item.id ? <LoaderCircle className="spin" size={14} /> : null} Check status</button> : null}</td><td>{new Date(item.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></div>}</section></main>;}

function satsLabel(sats: string) {
  return `${Number(sats).toLocaleString()} sats`;
}

function parseMinor(value: string, currency: "UGX" | "USD") {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error("Enter a valid positive amount");
  const [whole, fraction = ""] = value.split(".");
  return currency === "UGX" ? BigInt(whole).toString() : (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
}