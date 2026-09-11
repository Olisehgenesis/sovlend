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
};

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

  if (admin) {
    navSections.push({
      id: "admin",
      label: "Admin",
      items: [
        { type: "link", href: "/backoffice", label: "Admin panel" },
        { type: "link", href: "/backoffice/investors", label: "Investor access requests" },
        { type: "link", href: "/backoffice/products", label: "Products" },
        { type: "link", href: "/admin/users", label: "Users & access" },
        { type: "link", href: "/settings/team", label: "Team & permissions" },
        { type: "link", href: "/settings/security", label: "Settings" },
      ],
    });
  } else if (canManageProducts || canManageInvestors) {
    navSections.push({
      id: "admin",
      label: "Admin",
      items: [
        ...(canManageInvestors ? ([{ type: "link" as const, href: "/backoffice/investors", label: "Investor access requests" }] as NavItem[]) : []),
        ...(canManageProducts ? ([{ type: "link" as const, href: "/backoffice/products", label: "Products" }] as NavItem[]) : []),
      ],
    });
  }

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

  function toggleMenu(menu: string) {
    setOpenMenu((current) => (current === menu ? null : menu));
  }

  function closeMenus() {
    setOpenMenu(null);
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
        {navSections.map((section) => (
          <details key={section.id} open={openMenu === section.id}>
            <summary
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
        ))}
        <form className="header-global-search" onSubmit={handleGlobalSearch} role="search">
          <input
            aria-label="Search clients, loans, savings accounts, or groups"
            autoComplete="off"
            defaultValue={activeQuery}
            key={searchFieldKey}
            name="query"
            placeholder="Search client, account or loan"
            spellCheck={false}
            type="search"
          />
          <button aria-label="Search records" disabled={isSearching} type="submit">
            {isSearching ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />}
          </button>
        </form>
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
            {navSections.map((section) => (
              <details className="mobile-nav-section" key={section.id}>
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
