"use client";

import { ChevronDown, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AccountMenu } from "./account-menu";

export type ReportNavSection = { id: string; title: string; reports: { href: string; title: string }[] };

export function AppHeader({
  admin = false,
  canManageProducts = false,
  workspaceName,
  officeName,
  reportSections = [],
}: {
  admin?: boolean;
  canManageProducts?: boolean;
  workspaceName?: string | null;
  officeName?: string | null;
  reportSections?: ReportNavSection[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const navRef = useRef<HTMLElement>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const activeQuery = searchParams.get("query") ?? "";
  const searchFieldKey = `${pathname}:${activeQuery}`;

  useEffect(() => {
    const timeout = window.setTimeout(() => setOpenMenu(null), 0);
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

  function toggleMenu(menu: string) {
    setOpenMenu((current) => (current === menu ? null : menu));
  }

  function closeMenus() {
    setOpenMenu(null);
  }

  async function handleGlobalSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const rawQuery = formData.get("query");
    const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
    closeMenus();

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
      <div className="topbar-context">
        <Link className="topbar-context-link" href="/">
          <strong>{workspaceName ?? "SovLend"}</strong>
        </Link>
        {officeName ? <small>{officeName}</small> : null}
      </div>
      <nav className="header-nav" aria-label="Section navigation" ref={navRef}>
        <details open={openMenu === "clients"}>
          <summary
            onClick={(event) => {
              event.preventDefault();
              toggleMenu("clients");
            }}
          >
            Clients
            <ChevronDown size={13} />
          </summary>
          <div className="header-dropdown">
            <Link href="/clients" onClick={closeMenus}>
              Client list
            </Link>
            <Link href="/clients/new" onClick={closeMenus}>
              Add new client
            </Link>
          </div>
        </details>
        <details open={openMenu === "loans"}>
          <summary
            onClick={(event) => {
              event.preventDefault();
              toggleMenu("loans");
            }}
          >
            Loans
            <ChevronDown size={13} />
          </summary>
          <div className="header-dropdown">
            <Link href="/loans/new" onClick={closeMenus}>
              New application
            </Link>
            <hr className="header-dropdown-divider" />
            <p className="header-dropdown-group">Applications</p>
            <Link href="/loans/applications?status=SUBMITTED" onClick={closeMenus}>
              Submitted (needs review)
            </Link>
            <Link href="/loans/applications?status=APPROVED" onClick={closeMenus}>
              Active applications (awaiting disbursement)
            </Link>
            <Link href="/loans/applications" onClick={closeMenus}>
              All loan applications
            </Link>
            <hr className="header-dropdown-divider" />
            <p className="header-dropdown-group">Accounts</p>
            <Link href="/loans" onClick={closeMenus}>
              All active loans
            </Link>
            <Link href="/loans?status=IN_ARREARS" onClick={closeMenus}>
              Loans in arrears
            </Link>
            <Link href="/loans?status=OVERPAID" onClick={closeMenus}>
              Loans overpaid
            </Link>
            <Link href="/loans?status=WRITTEN_OFF" onClick={closeMenus}>
              Loans written off
            </Link>
            <Link href="/loans?status=CLOSED" onClick={closeMenus}>
              Loans closed
            </Link>
            <hr className="header-dropdown-divider" />
            <Link href="/loans/exports" onClick={closeMenus}>
              Exports
            </Link>
          </div>
        </details>
        <details open={openMenu === "accounts"}>
          <summary
            onClick={(event) => {
              event.preventDefault();
              toggleMenu("accounts");
            }}
          >
            Accounts
            <ChevronDown size={13} />
          </summary>
          <div className="header-dropdown">
            <Link href="/savings-accounts" onClick={closeMenus}>
              All savings accounts
            </Link>
          </div>
        </details>
        <details open={openMenu === "groups"}>
          <summary
            onClick={(event) => {
              event.preventDefault();
              toggleMenu("groups");
            }}
          >
            Groups
            <ChevronDown size={13} />
          </summary>
          <div className="header-dropdown">
            <Link href="/groups" onClick={closeMenus}>
              Groups &amp; centers
            </Link>
            <Link href="/groups/new" onClick={closeMenus}>
              Create group
            </Link>
          </div>
        </details>
        {admin ? (
          <details open={openMenu === "accounting"}>
            <summary
              onClick={(event) => {
                event.preventDefault();
                toggleMenu("accounting");
              }}
            >
              Accounting
              <ChevronDown size={13} />
            </summary>
            <div className="header-dropdown">
              <Link href="/backoffice/accounting" onClick={closeMenus}>
                Accounting mappings
              </Link>
            </div>
          </details>
        ) : null}
        <details open={openMenu === "reports"}>
          <summary
            onClick={(event) => {
              event.preventDefault();
              toggleMenu("reports");
            }}
          >
            Reports
            <ChevronDown size={13} />
          </summary>
          <div className="header-dropdown header-dropdown-reports">
            <Link href="/reports" onClick={closeMenus}>
              Reports home
            </Link>
            <Link href="/reports/all" onClick={closeMenus}>
              All reports
            </Link>
            {reportSections.map((section) => (
              <div key={section.id}>
                <hr className="header-dropdown-divider" />
                <p className="header-dropdown-group">{section.title}</p>
                {section.reports.map((report) => (
                  <Link href={report.href} key={report.href} onClick={closeMenus}>
                    {report.title}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </details>
        {admin ? (
          <details open={openMenu === "admin"}>
            <summary
              onClick={(event) => {
                event.preventDefault();
                toggleMenu("admin");
              }}
            >
              Admin
              <ChevronDown size={13} />
            </summary>
            <div className="header-dropdown">
              <Link href="/backoffice" onClick={closeMenus}>
                Admin panel
              </Link>
              <Link href="/backoffice/products" onClick={closeMenus}>
                Products
              </Link>
              <Link href="/admin/users" onClick={closeMenus}>
                Users &amp; access
              </Link>
              <Link href="/settings/team" onClick={closeMenus}>
                Team &amp; permissions
              </Link>
              <Link href="/settings/security" onClick={closeMenus}>
                Settings
              </Link>
            </div>
          </details>
        ) : canManageProducts ? (
          <details open={openMenu === "admin"}>
            <summary
              onClick={(event) => {
                event.preventDefault();
                toggleMenu("admin");
              }}
            >
              Admin
              <ChevronDown size={13} />
            </summary>
            <div className="header-dropdown">
              <Link href="/backoffice/products" onClick={closeMenus}>
                Products
              </Link>
            </div>
          </details>
        ) : null}
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
            <Search size={15} />
          </button>
        </form>
      </nav>
      <AccountMenu />
    </header>
  );
}
