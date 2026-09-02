import { BookOpenText, Building2, CircleDollarSign, LayoutDashboard, Settings, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";

import { SovLendMark } from "./sovlend-mark";

const primary = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/loans", label: "Loans", icon: CircleDollarSign },
];

export function OperationsNav({ active, admin = false }: { active: "overview" | "clients" | "loans" | "admin" | "security"; admin?: boolean }) {
  return <header className="operations-nav"><Link className="operations-brand" href="/"><SovLendMark size={26} /><span>SovLend</span></Link><nav aria-label="Workspace navigation">{primary.map((item) => { const Icon = item.icon; const selected = active === item.label.toLowerCase(); return <Link className={selected ? "selected" : ""} href={item.href} key={item.href}><Icon size={16} />{item.label}</Link>; })}{admin ? <><Link className={active === "admin" ? "selected" : ""} href="/backoffice"><ShieldCheck size={16} />Backoffice</Link><Link href="/backoffice/accounting"><BookOpenText size={16} />Accounting setup</Link><Link href="/admin/users"><Building2 size={16} />Users &amp; access</Link></> : null}</nav><Link className={active === "security" ? "nav-icon selected" : "nav-icon"} href="/settings/security" aria-label="Account security" title="Account security"><Settings size={17} /></Link></header>;
}