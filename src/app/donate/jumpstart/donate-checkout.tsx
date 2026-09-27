"use client";

import { useEffect, useMemo, useState } from "react";
import { createThirdwebClient } from "thirdweb";
import { base } from "thirdweb/chains";
import { BuyWidget, lightTheme, ThirdwebProvider } from "thirdweb/react";

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

function hideTokenAndWallet(root: HTMLElement) {
  const payLabel = [...root.querySelectorAll("span")].find((span) => span.textContent?.trim() === "Pay");
  if (!payLabel) return;

  const payHeader = ancestor(payLabel, 4);
  if (payHeader) payHeader.style.display = "none";

  const payCard = ancestor(payLabel, 5);
  payCard?.querySelectorAll("button").forEach((button) => {
    const label = button.textContent?.replace(/\s/g, "") ?? "";
    if (/^\$?\d+(\.\d+)?$/.test(label)) return;
    button.style.display = "none";
  });

  const toLabel = [...root.querySelectorAll("span")].find((span) => span.textContent?.trim() === "To");
  const toCard = toLabel ? ancestor(toLabel, 3) : null;
  if (toCard) {
    toCard.style.display = "none";
    if (toCard.previousElementSibling instanceof HTMLElement) toCard.previousElementSibling.style.display = "none";
  }

  const inputs = [...root.querySelectorAll("input")];
  const tokenInput = inputs.find((input) => Number.parseFloat(getComputedStyle(input).fontSize) >= 20);
  const dollarInput = inputs.find((input) => input !== tokenInput);
  if (tokenInput) tokenInput.style.setProperty("display", "none", "important");
  if (dollarInput) {
    dollarInput.style.fontSize = "24px";
    dollarInput.style.height = "32px";
    dollarInput.style.fontWeight = "500";
    dollarInput.style.color = "#17211b";
  }

  if (root.dataset.amountReady === "true") return;
  const preset = [...root.querySelectorAll("button")].find((button) => button.textContent?.replace(/\s/g, "") === "$25");
  if (!preset || preset.disabled) return;
  preset.click();
  root.dataset.amountReady = "true";
}

function useAmountOnlyRamp(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.querySelector<HTMLElement>(".donate-ramp");
    if (!root) return;

    hideTokenAndWallet(root);
    const observer = new MutationObserver(() => hideTokenAndWallet(root));
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [enabled]);
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
  useEffect(() => setMounted(true), []);
  useAmountOnlyRamp(Boolean(client && receiver && mounted && requestId));

  async function saveRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    const response = await fetch("/api/donations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(details),
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) {
      setFormError(result.error ?? "Could not save this donation");
      return;
    }
    setRequestId(result.id);
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
        </header>
        {requestId ? (
          client && receiver && mounted ? (
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
          ) : (
            <DonatePreview />
          )
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

function DonatePreview() {
  const [amount, setAmount] = useState<(typeof PLANS)[number]>(25);

  return (
    <>
      <div className="donate-plans" role="radiogroup" aria-label="Donation amount in US dollars">
        {PLANS.map((plan) => (
          <button
            key={plan}
            type="button"
            className="donate-plan"
            role="radio"
            aria-checked={amount === plan}
            onClick={() => setAmount(plan)}
          >
            ${plan}
          </button>
        ))}
      </div>
      <p className="donate-note">Card and crypto checkout needs a thirdweb client id in this environment.</p>
    </>
  );
}
