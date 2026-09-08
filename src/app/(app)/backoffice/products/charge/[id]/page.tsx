import { headers } from "next/headers";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { EditChargeDefinitionForm } from "@/components/product-forms";
import { auth } from "@/lib/auth";
import { canManageProducts } from "@/lib/can-manage-products";
import { formatMinorInput } from "@/lib/format-minor-input";
import { prisma } from "@/lib/prisma";

export default async function EditChargeDefinitionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const { allowed, organizationId } = await canManageProducts(session);
  if (!allowed || !organizationId) redirect("/");

  const { id } = await params;
  const charge = await prisma.chargeDefinition.findFirst({ where: { id, organizationId } });
  if (!charge) notFound();

  return <main className="directory-page">
    <Breadcrumbs items={[{ label: "Backoffice", href: "/backoffice" }, { label: "Products", href: "/backoffice/products" }, { label: charge.name }, { label: "Edit" }]} />
    <header className="directory-header"><div><p className="eyebrow">Product catalog</p><h1>Edit charge definition</h1><p>Update fee templates, penalty flags and how the charge is calculated.</p></div><Link className="secondary-action" href="/backoffice/products">Products</Link></header>
    <section className="panel form-panel">
      <div className="panel-heading"><div><h2>{charge.name}</h2><p>{charge.active ? "Active" : "Inactive"} · {charge.appliesTo}</p></div></div>
      <EditChargeDefinitionForm charge={{ id: charge.id, name: charge.name, appliesTo: charge.appliesTo === "SAVINGS" ? "SAVINGS" : "LOAN", calculationType: charge.calculationType === "PERCENTAGE" ? "PERCENTAGE" : "FLAT", amount: charge.amountMinor === null ? "" : formatMinorInput(charge.amountMinor), percentage: charge.percentageBps === null ? "" : (charge.percentageBps / 100).toFixed(2), currencyCode: charge.currencyCode, penalty: charge.penalty }} />
    </section>
  </main>;
}
