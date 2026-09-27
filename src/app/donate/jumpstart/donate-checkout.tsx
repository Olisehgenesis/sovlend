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

export function DonateCheckout({ clientId }: { clientId: string }) {
  const client = useMemo(() => (clientId ? createThirdwebClient({ clientId }) : null), [clientId]);
  const receiver = receiverAddress();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useAmountOnlyRamp(Boolean(client && receiver && mounted));

  return (
    <main className="donate-page">
      <section className="donate-card" aria-labelledby="donate-title">
        <header className="donate-intro">
          <h1 id="donate-title">Make a donation</h1>
          <p>No matter how small or great.</p>
        </header>
        {client && receiver && mounted ? (
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
              purchaseData={{ purpose: "jumpstart-donation" }}
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
