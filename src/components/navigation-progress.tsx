"use client";

import { LoaderCircle } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";

const NAVIGATE_EVENT = "app:navigate";

export function signalNavigation(label: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: { label } }));
}

export function NavigationProgress({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<NavigationFrame>{children}</NavigationFrame>}>
      <NavigationProgressInner>{children}</NavigationProgressInner>
    </Suspense>
  );
}

function NavigationProgressInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    setLabel(null);
  }, [pathname, search]);

  useEffect(() => {
    if (!label) return;
    const timer = window.setTimeout(() => setLabel(null), 45_000);
    return () => window.clearTimeout(timer);
  }, [label]);

  useEffect(() => {
    const currentUrl = () => `${window.location.pathname}${window.location.search}`;

    function onNavigate(event: Event) {
      const detail = (event as CustomEvent<{ label?: string }>).detail;
      setLabel(detail?.label?.trim() || "page");
    }

    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest("a");
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      if (anchor.origin !== window.location.origin) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || anchor.pathname.startsWith("/api/")) return;
      const next = `${anchor.pathname}${anchor.search}`;
      if (next === currentUrl()) return;
      const text = anchor.textContent?.replace(/\s+/g, " ").trim();
      setLabel(text ? text.slice(0, 80) : "page");
    }

    window.addEventListener(NAVIGATE_EVENT, onNavigate);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener(NAVIGATE_EVENT, onNavigate);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return <NavigationFrame label={label}>{children}</NavigationFrame>;
}

function NavigationFrame({ label, children }: { label?: string | null; children: ReactNode }) {
  return (
    <>
      {label ? (
        <div className="nav-pending" role="status">
          <span className="nav-pending-bar" />
          <p>
            <LoaderCircle aria-hidden className="spin" size={16} />
            Loading {label}…
          </p>
        </div>
      ) : null}
      <div className={label ? "is-navigating" : undefined}>{children}</div>
    </>
  );
}
