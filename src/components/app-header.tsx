"use client";

import { ChevronDown, LoaderCircle, Menu, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AccountMenu } from "./account-menu";
import { NotificationBell } from "./notification-bell";

export type ReportNavSection = { id: string; title: string; reports: { href: string; title: string }[] };

type NavItem =
  | { type: "link"; href: string; label: string }
  | { type: "divider"; key: string }
  | { type: "group"; key: string; label: string };

type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
  dropdownClassName?: string;
  quiet?: boolean;
};

type SearchSuggestion = {
  kind: string;
  label: string;
  detail: string;
  href: string;
};

function sectionIsCurrent(id: string, pathname: string) {
  if (id === "clients") return pathname.startsWith("/clients");
  if (id === "loans") return pathname.startsWith("/loans");
  if (id === "accounts") return pathname.startsWith("/savings-accounts");
  if (id === "groups") return pathname.startsWith("/groups");
  if (id === "accounting") return pathname.startsWith("/backoffice/accounting") || pathname.startsWith("/reports/accounting");
  if (id === "reports") return pathname.startsWith("/reports") && !pathname.startsWith("/reports/accounting");
  if (id === "docs") return pathname.startsWith("/docs");
  if (id === "more") return ["/backoffice", "/admin", "/settings", "/donations", "/donate"].some((prefix) => pathname.startsWith(prefix)) && !pathname.startsWith("/backoffice/accounting");
  return false;
}

function renderNavItems(items: NavItem[], onNavigate: () => void, variant: "desktop" | "mobile") {
  return items.map((item) => {
    if (item.type === "divider") {
      return <hr className={variant === "mobile" ? "mobile-nav-divider" : "header-dropdown-divider"} key={item.key} />;
    }
    if (item.type === "group") {
      return <p className={variant === "mobile" ? "mobile-nav-group" : "header-dropdown-group"} key={item.key}>{item.label}</p>;
    }
    return <Link className={variant === "mobile" ? "mobile-nav-link" : undefined} href={item.href} key={item.href} onClick={onNavigate}>{item.label}</Link>;
  });
}

export function AppHeader({
  admin = false,
  canManageProducts = false,
  canPostLedger = false,
  canManageInvestors = false,
  workspaceName,
  officeName,
  reportSections = [],
}: {
  admin?: boolean;
  canManageProducts?: boolean;
  canPostLedger?: boolean;
  canManageInvestors?: boolean;
  workspaceName?: string | null;
  officeName?: string | null;
  reportSections?: ReportNavSection[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const navRef = useRef<HTMLElement>(null);
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const mobileNavToggleRef = useRef<HTMLButtonElement>(null);
  const mobileNavCloseRef = useRef<HTMLButtonElement>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const shortcutLabel = typeof navigator === "undefined" || !/Mac|iPhone|iPad/.test(navigator.userAgent) ? "Ctrl K" : "⌘K";
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);
  const activeQuery = searchParams.get("query") ?? "";
  const searchFieldKey = `${pathname}:${activeQuery}`;
  const mobileNavTitleId = "mobile-navigation-title";
  const resolvedWorkspaceName = workspaceName ?? "SovLend";
  const reportItems: NavItem[] = [
    { type: "link", href: "/reports", label: "Reports home" },
    { type: "link", href: "/reports/all", label: "All reports" },
    ...reportSections.flatMap((section) => [
      { type: "divider" as const, key: `report-divider-${section.id}` },
      { type: "group" as const, key: `report-group-${section.id}`, label: section.title },
      ...section.reports.map((report) => ({ type: "link" as const, href: report.href, label: report.title })),
    ]),
  ];
  const navSections: NavSection[] = [
    {
      id: "clients",
      label: "Clients",
      items: [
        { type: "link", href: "/clients", label: "Client list" },
        { type: "link", href: "/clients/new", label: "Add new client" },
      ],
    },
    {
      id: "loans",
      label: "Loans",
      items: [
        { type: "link", href: "/loans/new", label: "New application" },
        { type: "divider", key: "loan-applications-divider" },
        { type: "group", key: "loan-applications-group", label: "Applications" },
        { type: "link", href: "/loans/applications?status=SUBMITTED", label: "Submitted (needs review)" },
        { type: "link", href: "/loans/applications?status=APPROVED", label: "Active applications (awaiting disbursement)" },
        { type: "link", href: "/loans/applications", label: "All loan applications" },
        { type: "divider", key: "loan-accounts-divider" },
        { type: "group", key: "loan-accounts-group", label: "Accounts" },
        { type: "link", href: "/loans", label: "All active loans" },
        { type: "link", href: "/loans?status=IN_ARREARS", label: "Loans in arrears" },
        { type: "link", href: "/loans?status=OVERPAID", label: "Loans overpaid" },
        { type: "link", href: "/loans?status=WRITTEN_OFF", label: "Loans written off" },
        { type: "link", href: "/loans?status=CLOSED", label: "Loans closed" },
        { type: "divider", key: "loan-exports-divider" },
        { type: "link", href: "/loans/exports", label: "Exports" },
      ],
    },
    {
      id: "accounts",
      label: "Accounts",
      items: [{ type: "link", href: "/savings-accounts", label: "All savings accounts" }],
    },
    {
      id: "groups",
      label: "Groups",
      items: [
        { type: "link", href: "/groups", label: "Groups & centers" },
        { type: "link", href: "/groups/new", label: "Create group" },
      ],
    },
  ];

  navSections.push({
    id: "donations",
    label: "Donations",
    items: [
      { type: "link", href: "/donations", label: "Donations overview" },
      { type: "link", href: "/donate/jumpstart", label: "Public donation page" },
    ],
  });

  if (admin || canPostLedger) {
    navSections.push({
      id: "accounting",
      label: "Accounting",
      items: [
        { type: "link", href: "/backoffice/accounting/income", label: "Record income" },
        { type: "link", href: "/backoffice/accounting/expense", label: "Record expense" },
        { type: "link", href: "/backoffice/accounting/journal-entries", label: "Add journal entries" },
        { type: "link", href: "/backoffice/accounting/frequent-postings", label: "Frequent postings" },
        { type: "link", href: "/backoffice/accounting/provisioning", label: "Provisioning entries" },
        { type: "link", href: "/reports/accounting/journal-reconciliation", label: "Search journal entries" },
        { type: "divider", key: "accounting-reports-divider" },
        { type: "link", href: "/reports/accounting/chart-of-accounts?accountType=REVENUE", label: "Incomes" },
        { type: "link", href: "/reports/accounting/chart-of-accounts?accountType=EXPENSE", label: "Expenses" },
        { type: "link", href: "/reports/accounting/income-statement", label: "Income statement" },
        ...(admin
          ? [
              { type: "divider" as const, key: "accounting-admin-divider" },
              { type: "link" as const, href: "/reports/accounting/chart-of-accounts", label: "Chart of accounts" },
              { type: "link" as const, href: "/backoffice/accounting", label: "Accounting mappings" },
              { type: "link" as const, href: "/backoffice/accounting/rules", label: "Accounting rules" },
              { type: "link" as const, href: "/backoffice/accounting/closures", label: "Closing entries" },
              { type: "link" as const, href: "/backoffice/accounting/opening-balances", label: "Migrate opening balances" },
            ]
          : []),
      ],
    });
  }

  navSections.push({
    id: "reports",
    label: "Reports",
    items: reportItems,
    dropdownClassName: "header-dropdown header-dropdown-reports",
  });

  navSections.push({
    id: "docs",
    label: "Docs",
    items: [
      { type: "link", href: "/docs", label: "All playbooks" },
      { type: "divider", key: "docs-roles-divider" },
      { type: "group", key: "docs-roles-group", label: "By role" },
      { type: "link", href: "/docs?role=teller", label: "Teller" },
      { type: "link", href: "/docs?role=loan-officer", label: "Loan officer" },
      { type: "link", href: "/docs?role=branch-manager", label: "Branch manager" },
      { type: "link", href: "/docs?role=general-manager", label: "General manager" },
      { type: "link", href: "/docs?role=treasury-signer", label: "Treasury signer" },
      { type: "link", href: "/docs?role=auditor", label: "Auditor" },
      { type: "link", href: "/docs?role=investor", label: "Investor" },
    ],
  });

  if (canManageInvestors) {
    navSections.push({
      id: "investors",
      label: "Investors",
      items: [{ type: "link", href: "/backoffice/investors", label: "Approve access requests" }],
    });
  }

  if (admin) {
    navSections.push({
      id: "admin",
      label: "Admin",
      items: [
        { type: "link", href: "/backoffice", label: "Admin panel" },
        { type: "link", href: "/backoffice/investors", label: "Investor access requests" },
        { type: "link", href: "/donations", label: "Donations" },
        { type: "link", href: "/backoffice/products", label: "Products" },
        { type: "link", href: "/admin/users", label: "Users & access" },
        { type: "link", href: "/settings/team", label: "Team & permissions" },
        { type: "link", href: "/settings/security", label: "Settings" },
      ],
    });
  } else if (canManageProducts) {
    navSections.push({
      id: "admin",
      label: "Admin",
      items: [{ type: "link", href: "/backoffice/products", label: "Products" }],
    });
  }

  const dailySectionIds = new Set(["clients", "loans", "accounts", "groups"]);
  const quietSectionIds = new Set(["accounting", "reports", "docs"]);
  const parkedSections = navSections.filter((section) => !dailySectionIds.has(section.id) && !quietSectionIds.has(section.id));
  const moreItems: NavItem[] = parkedSections.flatMap((section) => [
    { type: "group" as const, key: `more-${section.id}`, label: section.label },
    ...section.items,
  ]);
  const visibleSections: NavSection[] = [
    ...navSections.filter((section) => dailySectionIds.has(section.id)),
    ...navSections.filter((section) => quietSectionIds.has(section.id)).map((section) => ({ ...section, quiet: true })),
    ...(moreItems.length
      ? [{ id: "more", label: "More", quiet: true, items: moreItems, dropdownClassName: "header-dropdown header-dropdown-reports" }]
      : []),
  ];

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setOpenMenu(null);
      setMobileNavOpen(false);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [pathname]);

  useEffect(() => {
    if (!openMenu) return;

    function handleDocumentClick(event: MouseEvent) {
      if (navRef.current?.contains(event.target as Node)) return;
      setOpenMenu(null);
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenMenu(null);
    }

    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [openMenu]);

  useEffect(() => {
    if (!mobileNavOpen) return;

    function handleDocumentClick(event: MouseEvent) {
      const target = event.target as Node;
      if (mobileNavRef.current?.contains(target) || mobileNavToggleRef.current?.contains(target)) return;
      setMobileNavOpen(false);
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileNavOpen(false);
    }

    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    document.body.classList.add("mobile-nav-open");
    return () => document.body.classList.remove("mobile-nav-open");
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const timeout = window.setTimeout(() => mobileNavCloseRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [mobileNavOpen]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 761px)");

    function handleViewportChange(event: MediaQueryListEvent) {
      if (event.matches) setMobileNavOpen(false);
    }

    mediaQuery.addEventListener("change", handleViewportChange);
    return () => mediaQuery.removeEventListener("change", handleViewportChange);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSuggestionsOpen(false);
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (window.matchMedia("(max-width: 760px)").matches) {
        setMobileNavOpen(true);
        window.setTimeout(() => mobileSearchInputRef.current?.focus(), 0);
        return;
      }
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function toggleMenu(menu: string) {
    setSuggestionsOpen(false);
    setOpenMenu((current) => (current === menu ? null : menu));
  }

  function closeMenus() {
    setOpenMenu(null);
    setSuggestionsOpen(false);
  }

  async function loadSuggestions() {
    try {
      const response = await fetch("/api/search?suggest=recent", {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        setSuggestionsOpen(false);
        return;
      }
      const data = (await response.json()) as { items?: SearchSuggestion[] };
      const items = Array.isArray(data.items) ? data.items.filter((item) => typeof item.href === "string" && item.href.startsWith("/")) : [];
      setSuggestions(items);
      setSuggestionsOpen(items.length > 0);
    } catch {
      setSuggestionsOpen(false);
    }
  }

  function renderSearch(variant: "desktop" | "mobile") {
    return (
      <form
        className={`header-global-search${variant === "mobile" ? " header-global-search-mobile" : ""}${suggestionsOpen ? " showing-suggestions" : ""}`}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          setSuggestionsOpen(false);
        }}
        onSubmit={handleGlobalSearch}
        role="search"
      >
        <input
          aria-label="Search clients, loans, savings accounts, or groups"
          autoComplete="off"
          defaultValue={activeQuery}
          key={searchFieldKey}
          name="query"
          onChange={(event) => {
            if (event.target.value.trim()) setSuggestionsOpen(false);
          }}
          onFocus={(event) => {
            if (!event.currentTarget.value.trim()) void loadSuggestions();
          }}
          placeholder="Search client, account or loan"
          ref={variant === "desktop" ? searchInputRef : mobileSearchInputRef}
          spellCheck={false}
          type="search"
        />
        <kbd className="header-search-kbd" suppressHydrationWarning>{shortcutLabel}</kbd>
        <button aria-label="Search records" disabled={isSearching} type="submit">
          {isSearching ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />}
        </button>
        {suggestionsOpen && suggestions.length > 0 ? (
          <div className={`header-search-suggest${variant === "mobile" ? " header-search-suggest-inline" : ""}`} onMouseDown={(event) => event.preventDefault()}>
            <p>Recent</p>
            {suggestions.map((item) => (
              <Link
                href={item.href}
                key={`${variant}-${item.href}`}
                onClick={() => {
                  closeMenus();
                  closeMobileNavigation();
                }}
              >
                <span>{item.kind}</span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </Link>
            ))}
          </div>
        ) : null}
      </form>
    );
  }

  function toggleMobileNavigation() {
    closeMenus();
    setMobileNavOpen((current) => !current);
  }

  function closeMobileNavigation() {
    setMobileNavOpen(false);
  }

  async function handleGlobalSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const rawQuery = formData.get("query");
    const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
    closeMenus();
    closeMobileNavigation();

    if (!query) {
      router.push("/clients");
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (response.ok) {
        const data = (await response.json()) as { href?: string };
        if (typeof data.href === "string" && data.href.startsWith("/")) {
          router.push(data.href);
          return;
        }
      }
    } catch {
      // Fall back to the client directory if the resolver is unavailable.
    } finally {
      setIsSearching(false);
    }

    router.push(`/clients?query=${encodeURIComponent(query)}`);
  }

  return (
    <header className="topbar app-header">
      <button
        aria-expanded={mobileNavOpen}
        aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
        className="mobile-nav-toggle"
        onClick={toggleMobileNavigation}
        ref={mobileNavToggleRef}
        type="button"
      >
        {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
      </button>
      <div className="topbar-context">
        <Link className="topbar-context-link" href="/">
          <strong>{resolvedWorkspaceName}</strong>
        </Link>
        {officeName ? <small>{officeName}</small> : null}
      </div>
      <nav aria-label="Section navigation" className="header-nav" ref={navRef}>
        {visibleSections.map((section) => {
          const current = sectionIsCurrent(section.id, pathname);
          return (
            <details key={section.id} open={openMenu === section.id}>
              <summary
                aria-current={current ? "page" : undefined}
                className={[section.quiet ? "more-menu" : "", current ? "active" : ""].filter(Boolean).join(" ") || undefined}
                onClick={(event) => {
                  event.preventDefault();
                  toggleMenu(section.id);
                }}
              >
                {section.label}
                <ChevronDown size={13} />
              </summary>
              <div className={section.dropdownClassName ?? "header-dropdown"}>{renderNavItems(section.items, closeMenus, "desktop")}</div>
            </details>
          );
        })}
        {renderSearch("desktop")}
      </nav>
      {canManageInvestors ? <NotificationBell /> : null}
      <AccountMenu />
      <div aria-hidden={!mobileNavOpen} className={`mobile-nav-drawer${mobileNavOpen ? " open" : ""}`}>
        <button aria-label="Close navigation menu" className="mobile-nav-backdrop" onClick={closeMobileNavigation} tabIndex={mobileNavOpen ? 0 : -1} type="button" />
        <div aria-labelledby={mobileNavTitleId} aria-modal="true" className="mobile-nav-panel" ref={mobileNavRef} role="dialog">
          <div className="mobile-nav-panel-header">
            <div className="mobile-nav-panel-context">
              <strong id={mobileNavTitleId}>{resolvedWorkspaceName}</strong>
              {officeName ? <small>{officeName}</small> : null}
            </div>
            <button aria-label="Close navigation menu" className="mobile-nav-close" onClick={closeMobileNavigation} ref={mobileNavCloseRef} type="button">
              <X size={18} />
            </button>
          </div>
          <nav aria-label="Mobile section navigation" className="mobile-nav-panel-body">
            {renderSearch("mobile")}
            {visibleSections.map((section) => (
              <details className="mobile-nav-section" key={`${section.id}-${pathname}`} open={sectionIsCurrent(section.id, pathname) ? true : undefined}>
                <summary>
                  <span>{section.label}</span>
                  <ChevronDown size={16} />
                </summary>
                <div className="mobile-nav-section-items">{renderNavItems(section.items, closeMobileNavigation, "mobile")}</div>
              </details>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
