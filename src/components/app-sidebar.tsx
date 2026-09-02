"use client";

import { ChevronLeft, ChevronRight, LayoutDashboard, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { SovLendMark } from "./sovlend-mark";

export type NavSection = "overview" | "clients" | "loans" | "groups" | "accounting" | "reports" | "admin" | "security";

const STORAGE_KEY = "sovlend_sidebar_collapsed";

function sectionForPath(pathname: string): NavSection {
  if (pathname === "/") return "overview";
  if (pathname.startsWith("/clients")) return "clients";
  if (pathname.startsWith("/loans")) return "loans";
  if (pathname.startsWith("/groups")) return "groups";
  if (pathname.startsWith("/backoffice/accounting")) return "accounting";
  if (pathname.startsWith("/backoffice") || pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/reports")) return "reports";
  if (pathname.startsWith("/settings")) return "security";
  return "overview";
}

export function AppSidebar({ admin = false, workspaceName, officeName }: { admin?: boolean; workspaceName?: string | null; officeName?: string | null }) {
  const active = sectionForPath(usePathname());
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

  return (
    <aside className="sidebar" data-collapsed={collapsed}>
      <div className="brand"><span className="brand-mark"><SovLendMark size={20} /></span><span>SovLend</span><button aria-label={collapsed ? "Expand menu" : "Collapse menu"} className="sidebar-toggle" onClick={toggle} type="button">{collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}</button></div>
      {workspaceName ? <div className="workspace"><span>{workspaceName}</span><small>{officeName ?? "All offices"}</small></div> : null}

      <nav aria-label="Primary navigation">
        <Link className={active === "overview" ? "active" : ""} href="/"><LayoutDashboard size={18} /><span>Overview</span></Link>
      </nav>

      <div className="sidebar-bottom">
        {admin ? <Link className={active === "admin" ? "active" : ""} href="/backoffice"><ShieldCheck size={18} /><span>Backoffice</span></Link> : null}
        <Link className={active === "security" ? "active" : ""} href="/settings/security"><Settings size={18} /><span>Settings</span></Link>
      </div>
    </aside>
  );
}
