"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

const UNAVAILABLE = "Bitcoin transfer is unavailable right now.";

function donorMessage(error: string | undefined) {
  if (!error || /blink|failed with http/i.test(error)) return UNAVAILABLE;
  return error;
}

type Invoice = {
  id: string;
  status: string;
  amountSats: string;
  bolt11: string;
  expiresAt: string;
};

export function BitcoinDonation({
  donationId,
  amountUsd,
  onBack,
  onPaid,
  backLabel = "Back",
}: {
  donationId: string;
  amountUsd: string;
  onBack: () => void;
  onPaid?: () => void;
  backLabel?: string;
}) {
  const [invoice, setInvoice] = useState<(Invoice & { qr: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function createInvoice() {
      try {
        const response = await fetch(`/api/donations/${donationId}/lightning`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amountUsd }),
        });
        const result = (await response.json().catch(() => ({}))) as Partial<Invoice> & { error?: string };
        if (cancelled) return;
        if (!response.ok || !result.bolt11 || !result.amountSats || !result.expiresAt || !result.id) {
          setError(donorMessage(result.error));
          return;
        }
        const qr = await QRCode.toDataURL(result.bolt11, { width: 280, margin: 1, errorCorrectionLevel: "M" });
        if (cancelled) return;
        setInvoice({ id: result.id, status: result.status ?? "NEW", amountSats: result.amountSats, bolt11: result.bolt11, expiresAt: result.expiresAt, qr });
      } catch (error) {
        console.error("Donation Lightning invoice failed", error);
        if (!cancelled) setError(UNAVAILABLE);
      }
    }
    void createInvoice();
    return () => {
      cancelled = true;
    };
  }, [amountUsd, donationId]);

  useEffect(() => {
    if (!invoice || invoice.status === "PAID") return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/donations/${donationId}/lightning`);
      const result = (await response.json().catch(() => ({}))) as Partial<Invoice>;
      if (!response.ok || !result.status) return;
      setInvoice((current) => (current && current.status !== result.status ? { ...current, status: result.status ?? current.status } : current));
    }, 4000);
    return () => window.clearInterval(timer);
  }, [donationId, invoice]);

  useEffect(() => {
    if (invoice?.status !== "PAID" || !onPaid) return;
    const timer = window.setTimeout(onPaid, 900);
    return () => window.clearTimeout(timer);
  }, [invoice?.status, onPaid]);

  if (invoice?.status === "PAID") {
    return (
      <div className="donate-paid">
        <p>Thank you. Jumpstart received your Bitcoin contribution.</p>
      </div>
    );
  }

  return (
    <div className="donate-invoice">
      <button className="donate-back" type="button" onClick={onBack}>
        {backLabel}
      </button>
      {error ? <p className="donate-note">{error}</p> : null}
      {invoice ? (
        <>
          <img src={invoice.qr} alt="Lightning invoice QR code" width={220} height={220} />
          <p className="donate-sats">{Number(invoice.amountSats).toLocaleString()} sats</p>
          <p className="donate-wait">Waiting for your Bitcoin payment.</p>
          <button
            className="donate-copy"
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(invoice.bolt11).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy invoice"}
          </button>
        </>
      ) : error ? null : (
        <p className="donate-wait">Creating your Lightning invoice.</p>
      )}
    </div>
  );
}
