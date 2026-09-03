"use client";

import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Boxes,
  Briefcase,
  Building2,
  Calculator,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Download,
  HandCoins,
  LayoutDashboard,
  LockKeyhole,
  PiggyBank,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { SovLendMark } from "./sovlend-mark";

type NavSection = "overview" | "portfolio" | "insights" | "administration";

type NavItem = {
  exact?: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
  children?: NavItem[];
};

type NavGroup = {
  id: NavSection;
  label: string;
  items: NavItem[];
};

const STORAGE_KEY = "sovlend_sidebar_collapsed";

function isActivePath(pathname: string, item: NavItem) {
  if (item.exact || item.href === "/") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function sectionForPath(pathname: string): NavSection {
  if (pathname === "/") return "overview";
  if (
    pathname.startsWith("/clients") ||
    pathname.startsWith("/loans") ||
    pathname.startsWith("/groups") ||
    pathname.startsWith("/savings-accounts")
  ) {
    return "portfolio";
  }
  if (pathname.startsWith("/reports")) return "insights";
  if (
    pathname.startsWith("/backoffice") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/settings")
  ) {
    return "administration";
  }
  return "overview";
}

function NavEntry({ collapsed, item, pathname, subItem = false }: { collapsed: boolean; item: NavItem; pathname: string; subItem?: boolean }) {
  const active = isActivePath(pathname, item);
  const title = collapsed ? item.label : undefined;

  return (
    <div className="sidebar-item-group" data-active={active}>
      <Link aria-current={active ? "page" : undefined} className={`sidebar-link${subItem ? " sidebar-sub-link" : ""}${active ? " active" : ""}`} href={item.href} title={title}>
        <item.icon size={subItem ? 16 : 18} />
        <span className="sidebar-link-text">
          <span className="sidebar-link-label">{item.label}</span>
        </span>
      </Link>
      {item.children?.length ? (
        <div className="sidebar-subnav">
          {item.children.map((child) => (
            <NavEntry collapsed={collapsed} item={child} key={child.href} pathname={pathname} subItem />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AppSidebar({
  admin = false,
  canManageProducts = false,
  workspaceName,
  officeName,
}: {
  admin?: boolean;
  canManageProducts?: boolean;
  workspaceName?: string | null;
  officeName?: string | null;
}) {
  const pathname = usePathname();
  const activeSection = sectionForPath(pathname);
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    // one-time hydration read from localStorage; not a state subscription
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) !== "0");
  }, []);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const sections: NavGroup[] = [
    {
      id: "overview",
      label: "Overview",
      items: [{ exact: true, href: "/", icon: LayoutDashboard, label: "Dashboard" }],
    },
    {
      id: "portfolio",
      label: "Portfolio",
      items: [
        {
          href: "/clients",
          icon: Users,
          label: "Clients",
          children: [{ exact: true, href: "/clients/new", icon: UserPlus, label: "Add client" }],
        },
        {
          href: "/loans",
          icon: HandCoins,
          label: "Loans",
          children: [
            { exact: true, href: "/loans/new", icon: CirclePlus, label: "New application" },
            { exact: true, href: "/loans/exports", icon: Download, label: "Exports" },
          ],
        },
        {
          href: "/groups",
          icon: Building2,
          label: "Groups",
          children: [{ exact: true, href: "/groups/new", icon: CirclePlus, label: "Create group" }],
        },
        { href: "/savings-accounts", icon: PiggyBank, label: "Savings" },
      ],
    },
    {
      id: "insights",
      label: "Insights",
      items: [{ href: "/reports", icon: BarChart3, label: "Reports" }],
    },
    {
      id: "administration",
      label: "Administration",
      items: [
        ...(admin ? [{ exact: true, href: "/backoffice", icon: Briefcase, label: "Backoffice" }] : []),
        ...(admin ? [{ exact: true, href: "/backoffice/accounting", icon: Calculator, label: "Accounting" }] : []),
        ...(admin || canManageProducts ? [{ exact: true, href: "/backoffice/products", icon: Boxes, label: "Products" }] : []),
        ...(admin ? [{ exact: true, href: "/admin/users", icon: ShieldCheck, label: "Users & access" }] : []),
        { href: "/settings/security", icon: LockKeyhole, label: "Security" },
      ],
    },
  ];

  return (
    <aside className="sidebar sidebar-redesign" data-collapsed={collapsed}>
      <div className="brand">
        <span className="brand-mark">
          <SovLendMark size={20} />
        </span>
        <span className="sidebar-brand-name">SovLend</span>
        <button
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          className="sidebar-toggle"
          onClick={toggle}
          title={collapsed ? "Expand menu" : "Collapse menu"}
          type="button"
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>

      {workspaceName ? (
        <div className="workspace sidebar-workspace">
          <small>Workspace</small>
          <span>{workspaceName}</span>
          <strong>{officeName ?? "All offices"}</strong>
        </div>
      ) : null}

      <nav aria-label="Primary navigation" className="sidebar-nav">
        {sections.map((section) => (
          <section className="sidebar-section" data-active={activeSection === section.id} key={section.id}>
            <div className="sidebar-section-label">{section.label}</div>
            <div className="sidebar-section-items">
              {section.items.map((item) => (
                <NavEntry collapsed={collapsed} item={item} key={item.href} pathname={pathname} />
              ))}
            </div>
          </section>
        ))}
      </nav>
    </aside>
  );
}
