"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { AccountMenu } from "./account-menu";

export function AppHeader({ admin = false, canManageProducts = false, workspaceName, officeName }: { admin?: boolean; canManageProducts?: boolean; workspaceName?: string | null; officeName?: string | null }) {
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  useEffect(() => {
    setOpenMenu(null);
  }, [pathname]);

  function toggleMenu(menu: string) {
    setOpenMenu((current) => current === menu ? null : menu);
  }

  function closeMenus() {
    setOpenMenu(null);
  }

  return (
    <header className="topbar app-header">
      <div className="topbar-context"><strong>{workspaceName ?? "SovLend"}</strong>{officeName ? <small>{officeName}</small> : null}</div>
      <nav className="header-nav" aria-label="Section navigation">
        <details open={openMenu === "clients"}><summary onClick={(event) => { event.preventDefault(); toggleMenu("clients"); }}>Clients<ChevronDown size={13} /></summary><div className="header-dropdown"><Link href="/clients" onClick={closeMenus}>Client list</Link><Link href="/clients/new" onClick={closeMenus}>Add new client</Link></div></details>
        <details open={openMenu === "accounts"}><summary onClick={(event) => { event.preventDefault(); toggleMenu("accounts"); }}>Accounts<ChevronDown size={13} /></summary><div className="header-dropdown"><Link href="/loans" onClick={closeMenus}>All active loans</Link><Link href="/loans/new" onClick={closeMenus}>New application</Link></div></details>
        <details open={openMenu === "groups"}><summary onClick={(event) => { event.preventDefault(); toggleMenu("groups"); }}>Groups<ChevronDown size={13} /></summary><div className="header-dropdown"><Link href="/groups" onClick={closeMenus}>Groups &amp; centers</Link><Link href="/groups/new" onClick={closeMenus}>Create group</Link></div></details>
        {admin ? <details open={openMenu === "accounting"}><summary onClick={(event) => { event.preventDefault(); toggleMenu("accounting"); }}>Accounting<ChevronDown size={13} /></summary><div className="header-dropdown"><Link href="/backoffice/accounting" onClick={closeMenus}>Accounting mappings</Link></div></details> : null}
        <Link className="header-nav-link" href="/reports">Reports</Link>
        {admin ? <details open={openMenu === "admin"}><summary onClick={(event) => { event.preventDefault(); toggleMenu("admin"); }}>Admin<ChevronDown size={13} /></summary><div className="header-dropdown"><Link href="/backoffice" onClick={closeMenus}>Admin panel</Link><Link href="/backoffice/products" onClick={closeMenus}>Products</Link><Link href="/admin/users" onClick={closeMenus}>Users &amp; access</Link><Link href="/settings/security" onClick={closeMenus}>Settings</Link></div></details> : canManageProducts ? <details open={openMenu === "admin"}><summary onClick={(event) => { event.preventDefault(); toggleMenu("admin"); }}>Admin<ChevronDown size={13} /></summary><div className="header-dropdown"><Link href="/backoffice/products" onClick={closeMenus}>Products</Link></div></details> : null}
      </nav>
      <AccountMenu />
    </header>
  );
}
