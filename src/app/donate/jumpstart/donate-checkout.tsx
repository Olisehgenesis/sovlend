"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createThirdwebClient } from "thirdweb";
import { base } from "thirdweb/chains";
import { BuyWidget, lightTheme, ThirdwebProvider } from "thirdweb/react";

import { BitcoinDonation } from "./bitcoin-donation";

const PLANS = [10, 25, 100] as const;
const USDC_ON_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEFAULT_RECEIVER = "0x83755848696619E19116BEb84d7a6dEFc016dcFd";
const ABOUT_URL = "https://jumpstartafrica.org/about-us";

const theme = lightTheme({
  colors: {
    modalBg: "#ffffff",
    borderColor: "#dce2dc",
    separatorLine: "#dce2dc",
    primaryText: "#17211b",
    secondaryText: "#667069",
    accentText: "#174b35",
    primaryButtonBg: "#174b35",
    primaryButtonText: "#ffffff",
    accentButtonBg: "#174b35",
    accentButtonText: "#ffffff",
    secondaryButtonBg: "#f2f5f1",
    secondaryButtonText: "#17211b",
    secondaryButtonHoverBg: "#dceee5",
    selectedTextBg: "#dceee5",
    selectedTextColor: "#174b35",
    connectedButtonBg: "#174b35",
    connectedButtonBgHover: "#153529",
  },
});

function receiverAddress(): `0x${string}` | null {
  const value = process.env.NEXT_PUBLIC_DONATION_RECEIVER_ADDRESS || DEFAULT_RECEIVER;
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? (value as `0x${string}`) : null;
}

function ancestor(element: HTMLElement, depth: number) {
  let node: HTMLElement | null = element;
  for (let index = 0; index < depth; index += 1) node = node?.parentElement ?? null;
  return node;
}

function sanitizeAmount(value: string) {
  const cleaned = value.replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned.slice(0, 7);
  const whole = cleaned.slice(0, dot).slice(0, 7);
  const fraction = cleaned.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  return `${whole}.${fraction}`;
}

function payableAmount(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) return null;
  return value;
}

function writeInputValue(input: HTMLInputElement, value: string) {
  if (input.value === value) return;
  const prototype = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const tracker = (input as HTMLInputElement & { _valueTracker?: { setValue: (next: string) => void } })._valueTracker;
  tracker?.setValue(input.value);
  prototype?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function hideTokenAndWallet(root: HTMLElement, dollars: string) {
  const inputs = [...root.querySelectorAll("input")];
  for (const input of inputs) {
    if (input.dataset.donateRole) continue;
    const size = Number.parseFloat(getComputedStyle(input).fontSize);
    if (size >= 20) input.dataset.donateRole = "token";
    else if (input.placeholder === "0.0") input.dataset.donateRole = "fiat";
  }

  const payLabel = [...root.querySelectorAll("span")].find((span) => span.textContent?.trim() === "Pay");
  const payCard = payLabel ? ancestor(payLabel, 5) : null;
  if (payCard) payCard.style.display = "none";

  const toLabel = [...root.querySelectorAll("span")].find((span) => span.textContent?.trim() === "To");
  const toCard = toLabel ? ancestor(toLabel, 3) : null;
  if (toCard) {
    toCard.style.display = "none";
    if (toCard.previousElementSibling instanceof HTMLElement) toCard.previousElementSibling.style.display = "none";
  }

  const fiat = root.querySelector<HTMLInputElement>('input[data-donate-role="fiat"]');
  if (fiat) writeInputValue(fiat, payableAmount(dollars) ?? "0");
}

function useAmountOnlyRamp(enabled: boolean, amount: string) {
  const amountRef = useRef(amount);
  amountRef.current = amount;

  useEffect(() => {
    if (!enabled) return;
    const card = document.querySelector(".donate-card");
    if (!card) return;

    const apply = () => {
      const root = card.querySelector<HTMLElement>(".donate-ramp");
      if (root) hideTokenAndWallet(root, amountRef.current);
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(card, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const root = document.querySelector<HTMLElement>(".donate-ramp");
    if (root) hideTokenAndWallet(root, amount);
  }, [amount, enabled]);
}

type DonationDetails = {
  name: string;
  email: string;
  message: string;
  moreBiodata: boolean;
  country: string;
  phone: string;
  city: string;
};

const emptyDetails: DonationDetails = {
  name: "",
  email: "",
  message: "",
  moreBiodata: false,
  country: "",
  phone: "",
  city: "",
};

export function DonateCheckout({ clientId }: { clientId: string }) {
  const client = useMemo(() => (clientId ? createThirdwebClient({ clientId }) : null), [clientId]);
  const receiver = receiverAddress();
  const [mounted, setMounted] = useState(false);
  const [details, setDetails] = useState<DonationDetails>(emptyDetails);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [amount, setAmount] = useState("25");
  const [choosingPayment, setChoosingPayment] = useState(false);
  const [bitcoinOpen, setBitcoinOpen] = useState(false);
  const chosenAmount = payableAmount(amount);
  useEffect(() => setMounted(true), []);
  useAmountOnlyRamp(Boolean(client && receiver && mounted && requestId), amount);

  useEffect(() => {
    if (!requestId) return;
    const card = document.querySelector(".donate-card");
    if (!card) return;
    const sync = () => {
      const ramp = card.querySelector(".donate-ramp");
      setChoosingPayment(Boolean(ramp?.textContent?.includes("Choose Payment Method")));
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(card, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [requestId]);

  async function saveRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch("/api/donations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(details),
      });
      const result = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!response.ok || !result.id) {
        setFormError(result.error ?? "Could not save this donation");
        return;
      }
      setRequestId(result.id);
    } catch {
      setFormError("Could not save this donation");
    } finally {
      setSaving(false);
    }
  }

  function updateDetail<Key extends keyof DonationDetails>(key: Key, value: DonationDetails[Key]) {
    setDetails((current) => ({ ...current, [key]: value }));
  }

  return (
    <main className="donate-page">
      <section className="donate-card" aria-labelledby="donate-title">
        <header className="donate-intro">
          <h1 id="donate-title">Make a donation</h1>
          <p>No matter how small or great.</p>
          <p className="donate-cause">
            {requestId && chosenAmount ? `You are contributing $${chosenAmount} to Jumpstart.` : "You are contributing to Jumpstart."}
          </p>
        </header>
        {requestId ? (
          <>
            {bitcoinOpen && chosenAmount ? (
              <BitcoinDonation donationId={requestId} amountUsd={chosenAmount} onBack={() => setBitcoinOpen(false)} />
            ) : choosingPayment ? null : (
              <>
                <AmountChooser amount={amount} onChange={setAmount} />
                {!client && chosenAmount ? (
                  <button className="donate-bitcoin" type="button" onClick={() => setBitcoinOpen(true)}>
                    <strong>Pay with Bitcoin</strong>
                    <span>Lightning invoice</span>
                  </button>
                ) : null}
              </>
            )}
            {client && receiver && mounted ? (
              <div className={bitcoinOpen ? "donate-ramp-hidden" : undefined}>
              <ThirdwebProvider>
              <BuyWidget
                client={client}
                chain={base}
                tokenAddress={USDC_ON_BASE}
                amount="25"
                amountEditable
                tokenEditable={false}
                presetOptions={[10, 25, 100]}
                currency="USD"
                paymentMethods={["crypto", "card"]}
                receiverAddress={receiver}
                title=""
                buttonLabel="Next"
                theme={theme}
                showThirdwebBranding
                className="donate-ramp"
                style={{ width: "100%", border: "none", borderRadius: 0, boxShadow: "none" }}
                purchaseData={{ purpose: "jumpstart-donation", donationRequestId: requestId }}
                onSuccess={() => {
                  void fetch(`/api/donations/${requestId}/succeed`, { method: "POST" });
                }}
                connectOptions={{
                  appMetadata: {
                    name: "Jumpstart",
                    url: "https://jumpstartafrica.org",
                    description: "Donate to Jumpstart Africa",
                  },
                  connectModal: { size: "compact", title: "Pay with crypto" },
                }}
              />
              </ThirdwebProvider>
              </div>
            ) : bitcoinOpen ? null : (
              <p className="donate-note">Card and crypto checkout needs a thirdweb client id in this environment.</p>
            )}
            {!bitcoinOpen && choosingPayment && chosenAmount ? (
              <button className="donate-bitcoin" type="button" onClick={() => setBitcoinOpen(true)}>
                <strong>Pay with Bitcoin</strong>
                <span>Lightning invoice</span>
              </button>
            ) : null}
          </>
        ) : (
          <DonationDetailsForm
            details={details}
            saving={saving}
            error={formError}
            onChange={updateDetail}
            onSubmit={saveRequest}
          />
        )}
        <footer className="donate-foot">
          <p className="donate-rails">
            <span>Visa</span>
            <span>Mastercard</span>
            <span>Bitcoin</span>
            <span>Crypto</span>
          </p>
          <a className="donate-more" href={ABOUT_URL} target="_top" rel="noopener noreferrer">
            Read more
          </a>
        </footer>
      </section>
    </main>
  );
}

function DonationDetailsForm({
  details,
  saving,
  error,
  onChange,
  onSubmit,
}: {
  details: DonationDetails;
  saving: boolean;
  error: string | null;
  onChange: <Key extends keyof DonationDetails>(key: Key, value: DonationDetails[Key]) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="donate-form" onSubmit={onSubmit}>
      <label>
        Name
        <input name="name" autoComplete="name" required value={details.name} onChange={(event) => onChange("name", event.target.value)} />
      </label>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required value={details.email} onChange={(event) => onChange("email", event.target.value)} />
      </label>
      <label>
        Message
        <textarea name="message" rows={3} value={details.message} onChange={(event) => onChange("message", event.target.value)} />
      </label>
      <label className="donate-check">
        <input
          name="moreBiodata"
          type="checkbox"
          checked={details.moreBiodata}
          onChange={(event) => onChange("moreBiodata", event.target.checked)}
        />
        Give more about yourself
      </label>
      {details.moreBiodata ? (
        <div className="donate-extra">
          <label>
            Country
            <input name="country" autoComplete="country-name" value={details.country} onChange={(event) => onChange("country", event.target.value)} />
          </label>
          <label>
            Phone
            <input name="phone" type="tel" autoComplete="tel" value={details.phone} onChange={(event) => onChange("phone", event.target.value)} />
          </label>
          <label>
            City
            <input name="city" autoComplete="address-level2" value={details.city} onChange={(event) => onChange("city", event.target.value)} />
          </label>
        </div>
      ) : null}
      {error ? <p className="donate-note">{error}</p> : null}
      <button className="donate-continue" type="submit" disabled={saving}>
        {saving ? "Saving" : "Continue"}
      </button>
    </form>
  );
}

function AmountChooser({ amount, onChange }: { amount: string; onChange: (value: string) => void }) {
  return (
    <div className="donate-amount">
      <div className="donate-plans" role="radiogroup" aria-label="Suggested donation amounts in US dollars">
        {PLANS.map((plan) => (
          <button
            key={plan}
            type="button"
            className="donate-plan"
            role="radio"
            aria-checked={amount === String(plan)}
            onClick={() => onChange(String(plan))}
          >
            ${plan}
          </button>
        ))}
      </div>
      <label className="donate-custom">
        Amount
        <span className="donate-custom-field">
          <span aria-hidden="true">$</span>
          <input
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="Any amount"
            aria-label="Donation amount in US dollars"
            value={amount}
            onChange={(event) => onChange(sanitizeAmount(event.target.value))}
          />
        </span>
      </label>
    </div>
  );
}
