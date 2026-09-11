"use client";

import { Bitcoin, Building2, Clock3, LoaderCircle, QrCode, TrendingUp, Wallet } from "lucide-react";
import { formatMinor } from "@/modules/money/domain/format-minor";
import Image from "next/image";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Access = { id: string; organizationId: string; organizationName: string };
type PendingAccess = { id: string; organizationId: string; organizationName: string; status: string; createdAt: string };
type Commitment = { id: string; organizationName: string; amount: string; sats: string; status: string; createdAt: string };
type Invoice = { id: string; bolt11: string; expiresAt: string; amountSats: string };
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
type RequestableOrganization = { id: string; name: string };

export function InvestorBoard({ investorName, accesses, pendingAccesses, commitments, btcExposure, portfolio, requestableOrganizations }: { investorName: string; accesses: Access[]; pendingAccesses: PendingAccess[]; commitments: Commitment[]; btcExposure: BtcExposure[]; portfolio: Portfolio; requestableOrganizations: RequestableOrganization[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [invoice, setInvoice] = useState<(Invoice & { qr: string }) | null>(null);
  // The just-created invoice's row, shown immediately (before router.refresh() below picks it up
  // from the server) -- and any locally-known status updates from a manual "Check status" click.
  // Deriving `rows` from these plus the `commitments` prop (instead of copying it into its own
  // state and re-syncing in an effect) avoids setState-in-effect cascading renders.
  const [optimisticRow, setOptimisticRow] = useState<Commitment | null>(null);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [availableOrganizations, setAvailableOrganizations] = useState(requestableOrganizations);

  const rows = (optimisticRow && !commitments.some((row) => row.id === optimisticRow.id) ? [optimisticRow, ...commitments] : commitments).map((row) =>
    statusOverrides[row.id] ? { ...row, status: statusOverrides[row.id] } : row,
  );

  // Settlement normally arrives via the Blink webhook, and a worker job re-polls every open
  // invoice as a safety net (see scan-pending-investment-settlements.ts) -- but neither pushes an
  // update to this open tab. Poll the server (a cheap DB read, not a new Blink call) while
  // anything here is still settling so the status/animation update on their own.
  useEffect(() => {
    const settling = rows.some((row) => row.status === "AWAITING_PAYMENT" || row.status === "SETTLEMENT_PENDING");
    if (!settling) return;
    const interval = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(interval);
  }, [rows, router]);

  const fundableOrgs = [
    ...accesses.map((access) => ({ organizationId: access.organizationId, organizationName: access.organizationName, pending: false })),
    ...pendingAccesses.filter((access) => access.status === "REQUESTED").map((access) => ({ organizationId: access.organizationId, organizationName: access.organizationName, pending: true })),
  ];
  const [requestingAccess, setRequestingAccess] = useState(false);
  const [amountInput, setAmountInput] = useState("");
  const [quoteCurrency, setQuoteCurrency] = useState<"UGX" | "USD">("UGX");
  const [quote, setQuote] = useState<{ amountSats: string; approximate?: boolean } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  // Debounced "how many sats is this?" preview -- fires once, ~600ms after the investor stops
  // typing, so it does not spam the price provider on every keystroke. Uses the DISPLAY price
  // purpose server-side, which is served from an hourly cache instead of a live lookup.
  useEffect(() => {
    const amountMinor = (() => {
      try {
        const parsed = parseMinor(amountInput, quoteCurrency);
        return parsed === "0" ? null : parsed;
      } catch {
        return null;
      }
    })();

    const timer = setTimeout(() => {
      if (!amountMinor) {
        setQuote(null);
        setQuoteLoading(false);
        return;
      }
      setQuoteLoading(true);
      fetch(`/api/investments/quote?currencyCode=${quoteCurrency}&amountMinor=${amountMinor}`)
        .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
        .then(({ ok, payload }) => setQuote(ok ? payload : null))
        .catch(() => setQuote(null))
        .finally(() => setQuoteLoading(false));
    }, 600);
    return () => clearTimeout(timer);
  }, [amountInput, quoteCurrency]);

  async function requestAccess(formData: FormData) {
    setRequestingAccess(true);
    try {
      const organizationId = String(formData.get("organizationId"));
      const response = await fetch("/api/investor/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Request could not be sent");
      setAvailableOrganizations((current) => current.filter((org) => org.id !== organizationId));
      toast.success("Access requested -- an admin will review it shortly");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Request could not be sent");
    } finally {
      setRequestingAccess(false);
    }
  }

  async function checkStatus(id: string) {
    setCheckingId(id);
    try {
      const response = await fetch(`/api/investments/${id}/check-status`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not check payment status");
      setStatusOverrides((prev) => ({ ...prev, [id]: payload.status }));
      toast[payload.status === "AWAITING_PAYMENT" ? "message" : "success"](payload.status === "AWAITING_PAYMENT" ? "Still awaiting payment" : "Payment status updated");
      if (payload.status !== "AWAITING_PAYMENT") setInvoice((prev) => (prev?.id === id ? null : prev));
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
      const organizationId = String(formData.get("organizationId"));
      const currencyCode = String(formData.get("currencyCode")) as "UGX" | "USD";
      const amountMinor = parseMinor(String(formData.get("amount")), currencyCode);
      const response = await fetch("/api/investments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, currencyCode, amountMinor, idempotencyKey: crypto.randomUUID() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Investment invoice could not be created");
      if (!payload.invoice) throw new Error("Invoice creation is still processing");
      const qr = await QRCode.toDataURL(payload.invoice.bolt11, { width: 360, margin: 2, errorCorrectionLevel: "M" });
      setInvoice({ ...payload.invoice, id: payload.id, amountSats: payload.amountSats, qr });
      // Reflect the new commitment in the history table immediately -- otherwise the "Check
      // status" button (and the row itself) only shows up after a full page reload, since
      // `rows` is only seeded once from the server-rendered `commitments` prop.
      const organizationName = fundableOrgs.find((org) => org.organizationId === organizationId)?.organizationName ?? "Business";
      setOptimisticRow({ id: payload.id, organizationName, amount: formatMinor(BigInt(amountMinor), currencyCode), sats: Number(payload.amountSats).toLocaleString(), status: "AWAITING_PAYMENT", createdAt: new Date().toISOString() });
      setAmountInput("");
      setQuote(null);
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
      {portfolio.timeline.length > 1 ? <div className="portfolio-chart"><ResponsiveContainer width="100%" height={180}><AreaChart data={portfolio.timeline}><CartesianGrid strokeDasharray="3 3" stroke="#e3ece6" /><XAxis dataKey="date" fontSize={11} stroke="#7c8b82" /><YAxis fontSize={11} stroke="#7c8b82" width={70} tickFormatter={(value: number) => value.toLocaleString()} /><            Tooltip formatter={(value: unknown) => [`${Number(value).toLocaleString()} sats`, "Cumulative funded"]} /><Area type="monotone" dataKey="cumulativeSats" stroke="#25814f" fill="#cfebd8" /></AreaChart></ResponsiveContainer></div> : <p className="chart-empty-note"><Clock3 size={14} /> A growth chart appears once you have two or more settled deposits.</p>}    </section>    <section className="investor-grid"><article className="panel invest-panel"><div className="panel-heading"><div><h2>Make an investment</h2><p>A fresh rate is locked when the invoice is created.</p></div><Bitcoin size={19} /></div>{pendingAccesses.some((access) => access.status === "INVITED") ? <div className="pending-access-list">{pendingAccesses.filter((access) => access.status === "INVITED").map((access) => <div className="pending-access-row" key={access.id}><Building2 size={16} /><span>{access.organizationName}</span><span className="status review">Invited -- check your email to accept</span></div>)}</div> : null}{fundableOrgs.length === 0 ? <div className="empty-state"><Building2 size={28} /><strong>No approved businesses</strong><p>Request access to a business before investing -- an admin reviews every request.</p>{availableOrganizations.length > 0 ? <form action={requestAccess} className="stack-form compact-form"><label>Business<select name="organizationId" required defaultValue=""><option value="" disabled>Select a business</option>{availableOrganizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label><button className="invest-button" disabled={requestingAccess}>{requestingAccess ? <LoaderCircle className="spin" size={18} /> : <Building2 size={18} />} Request access</button></form> : <small>No businesses are available to request right now.</small>}</div> : <>{pendingAccesses.some((access) => access.status === "REQUESTED") ? <div className="pending-access-list">{pendingAccesses.filter((access) => access.status === "REQUESTED").map((access) => <div className="pending-access-row" key={access.id}><Building2 size={16} /><span>{access.organizationName}</span><span className="status review">Pending review -- you can still fund it</span></div>)}</div> : null}<form action={invest} className="stack-form"><label>Business<select name="organizationId" required>{fundableOrgs.map((org) => <option value={org.organizationId} key={org.organizationId}>{org.organizationName}{org.pending ? " (pending approval)" : ""}</option>)}</select></label><div className="amount-row"><label>Amount<input name="amount" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" required value={amountInput} onChange={(event) => setAmountInput(event.target.value)} /></label><label>Currency<select name="currencyCode" value={quoteCurrency} onChange={(event) => setQuoteCurrency(event.target.value as "UGX" | "USD")}><option value="UGX">UGX</option><option value="USD">USD</option></select></label></div>{quoteLoading ? <small className="quote-preview"><LoaderCircle className="spin" size={12} /> Estimating sats…</small> : quote ? <small className="quote-preview">≈ {Number(quote.amountSats).toLocaleString()} sats{quote.approximate ? " (approximate rate)" : " at the current rate"}</small> : null}<button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={18} /> : <QrCode size={18} />} Create Lightning invoice</button></form>{availableOrganizations.length > 0 ? <form action={requestAccess} className="stack-form compact-form"><label>Request access to another business<select name="organizationId" required defaultValue=""><option value="" disabled>Select a business</option>{availableOrganizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label><button className="invest-button" disabled={requestingAccess}>{requestingAccess ? <LoaderCircle className="spin" size={18} /> : <Building2 size={18} />} Request access</button></form> : null}</>}</article>{invoice ? <article className="panel invoice-panel"><div className="panel-heading"><div><h2>Scan to invest</h2><p>{invoice.amountSats} sats · expires {new Date(invoice.expiresAt).toLocaleTimeString()}</p></div></div><Image src={invoice.qr} width={280} height={280} unoptimized alt="Lightning invoice QR code" /><code>{invoice.bolt11}</code><div className="invoice-status-row"><span className={`status ${(rows.find((row) => row.id === invoice.id)?.status ?? "AWAITING_PAYMENT") === "SETTLEMENT_PENDING" ? "settling" : "review"}`}>{(rows.find((row) => row.id === invoice.id)?.status ?? "AWAITING_PAYMENT") === "SETTLEMENT_PENDING" ? <span className="settling-dot" /> : null}{(rows.find((row) => row.id === invoice.id)?.status ?? "AWAITING_PAYMENT").replaceAll("_", " ")}</span><button type="button" className="check-status-button" disabled={checkingId === invoice.id} onClick={() => checkStatus(invoice.id)}>{checkingId === invoice.id ? <LoaderCircle className="spin" size={14} /> : null} Check payment status</button></div><small>Keep this page open while payment confirms.</small></article> : <article className="panel invoice-placeholder"><QrCode size={34} /><strong>Your invoice will appear here</strong><p>Nothing is reserved until an invoice is generated.</p></article>  }</section>{btcExposure.length > 0 ? <section className="panel btc-exposure"><div className="panel-heading"><div><h2>Bitcoin exposure</h2><p>Read-only summary -- SovLend does not move funds here (Phase 1 custody design)</p></div><Bitcoin size={19} /></div><div className="table-scroll"><table><thead><tr><th>Business</th><th>Client BTC held</th><th>Your funded BTC</th><th>Total BTC value</th><th>Fiat portfolio</th><th>Funds under management</th><th>BTC exposure</th></tr></thead><tbody>{btcExposure.map((item) => <tr key={item.organizationId}><td><strong>{item.organizationName}</strong></td><td>{satsLabel(item.clientBtcSats)}</td><td>{satsLabel(item.investorFundedSats)}</td><td>{item.totalBtcValueFormatted ?? <span className="muted-text">Price unavailable</span>}</td><td>{item.fiatPortfolioFormatted}</td><td>{item.fundsUnderManagementFormatted}</td><td>{item.btcExposurePercent}%</td></tr>)}</tbody></table></div></section> : null}<section className="panel investment-history"><div className="panel-heading"><div><h2>Investment history</h2><p>All commitments linked to your account</p></div><TrendingUp size={19} /></div>{rows.length === 0 ? <div className="empty-state"><TrendingUp size={28} /><strong>No investments yet</strong><p>Your first Lightning invoice and settlement will appear here.</p></div> : <div className="table-scroll"><table><thead><tr><th>Business</th><th>Contribution</th><th>Bitcoin</th><th>Status</th><th>Created</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td><strong>{item.organizationName}</strong></td><td>{item.amount}</td><td>{item.sats} sats</td><td><span className={`status ${item.status === "FUNDED" ? "up-to-date" : item.status === "SETTLEMENT_PENDING" ? "settling" : "review"}`}>{item.status === "SETTLEMENT_PENDING" ? <span className="settling-dot" /> : null}{item.status.replaceAll("_", " ")}</span>{item.status === "AWAITING_PAYMENT" || item.status === "SETTLEMENT_PENDING" ? <button type="button" className="check-status-button" disabled={checkingId === item.id} onClick={() => checkStatus(item.id)}>{checkingId === item.id ? <LoaderCircle className="spin" size={14} /> : null} Check status</button> : null}</td><td>{investorDateFormatter.format(new Date(item.createdAt))}</td></tr>)}</tbody></table></div>}</section></main>;}

function satsLabel(sats: string) {
  return `${Number(sats).toLocaleString()} sats`;
}

// Explicit locale avoids a server/client hydration mismatch: `toLocaleDateString()` without an
// argument uses the server process's default locale, which can differ from the browser's.
const investorDateFormatter = new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" });

// amountMinor is always ×100-scaled (2 decimal places), matching the money convention used
// everywhere else in the app (see repayment-form.tsx's identical parsing) -- even for UGX,
// which has no real subunit, for consistency with formatMinor/contributionToSats.
function parseMinor(value: string, _currency: "UGX" | "USD") {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error("Enter a valid positive amount");
  const [whole, fraction = ""] = value.split(".");
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
}