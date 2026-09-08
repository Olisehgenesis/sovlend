import { headers } from "next/headers";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { EditLoanProductForm } from "@/components/product-forms";
import { auth } from "@/lib/auth";
import { canManageProducts } from "@/lib/can-manage-products";
import { formatMinorInput } from "@/lib/format-minor-input";
import { prisma } from "@/lib/prisma";

export default async function EditLoanProductPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const { allowed, organizationId } = await canManageProducts(session);
  if (!allowed || !organizationId) redirect("/");

  const { id } = await params;
  const product = await prisma.loanProduct.findFirst({ where: { id, organizationId } });
  if (!product) notFound();

  return <main className="directory-page">
    <Breadcrumbs items={[{ label: "Backoffice", href: "/backoffice" }, { label: "Products", href: "/backoffice/products" }, { label: product.name }, { label: "Edit" }]} />
    <header className="directory-header"><div><p className="eyebrow">Product catalog</p><h1>Edit loan product</h1><p>Update live loan product settings without touching existing loan snapshots or schedules.</p></div><Link className="secondary-action" href="/backoffice/products">Products</Link></header>
    <section className="panel form-panel">
      <div className="panel-heading"><div><h2>{product.name}</h2><p>{product.shortName} · {product.active ? "Active" : "Inactive"}</p></div></div>
      <EditLoanProductForm product={{ id: product.id, name: product.name, shortName: product.shortName, denominationCurrency: product.denominationCurrency, principalMin: formatMinorInput(product.principalMinMinor), principalMax: formatMinorInput(product.principalMaxMinor), annualRate: (product.annualRateBps / 100).toFixed(2), monitoringFeeAnnualRate: (product.monitoringFeeAnnualRateBps / 100).toFixed(2), repaymentCount: product.repaymentCount, repaymentFrequency: product.repaymentFrequency, amortizationMethod: product.amortizationMethod, interestMethod: product.interestMethod === "Declining Balance" || product.interestMethod === "DECLINING_BALANCE" ? "Declining Balance" : "Flat" }} />
    </section>
  </main>;
}
