import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ArchiveToggleButton } from "@/components/archive-toggle-button";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CreateChargeDefinitionForm, CreateSavingsProductForm } from "@/components/product-forms";
import { auth } from "@/lib/auth";
import { canManageProducts } from "@/lib/can-manage-products";
import { prisma } from "@/lib/prisma";
import { formatMinor } from "@/modules/money/domain/format-minor";

export default async function ProductsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const { allowed, organizationId } = await canManageProducts(session);
  if (!allowed || !organizationId) redirect("/");

  const [loanProducts, savingsProducts, chargeDefinitions] = await Promise.all([
    prisma.loanProduct.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    prisma.savingsProduct.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    prisma.chargeDefinition.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
  ]);

  return <main className="directory-page">
    <Breadcrumbs items={[{ label: "Backoffice", href: "/backoffice" }, { label: "Products" }]} />
    <header className="directory-header"><div><p className="eyebrow">Product catalog</p><h1>Products</h1><p>Loan, savings and charge templates used when opening client accounts.</p></div><Link className="secondary-action" href="/backoffice">Backoffice</Link></header>

    <section className="panel">
      <div className="panel-heading"><div><h2>Loan products</h2><p>Configured in the accounting mappings screen; shown here for reference.</p></div></div>
      {loanProducts.length === 0 ? <div className="empty-state compact-empty"><strong>No loan products yet</strong></div> : <div className="table-scroll"><table><thead><tr><th>Name</th><th>Principal range</th><th>Rate</th><th>Repayments</th><th>Status</th><th></th></tr></thead><tbody>{loanProducts.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.shortName}</small></td><td>{formatMinor(product.principalMinMinor, product.denominationCurrency)}{"\u2013"}{formatMinor(product.principalMaxMinor, product.denominationCurrency)}</td><td>{(product.annualRateBps / 100).toFixed(2)}%</td><td>{product.repaymentCount}{"\u00d7"}{product.repaymentFrequency.toLowerCase()}</td><td><span className={`status ${product.active ? "up-to-date" : "review"}`}>{product.active ? "Active" : "Inactive"}</span></td><td><ArchiveToggleButton active={product.active} url={`/api/backoffice/loan-products/${product.id}`} /></td></tr>)}</tbody></table></div>}
    </section>

    <section className="panel">
      <div className="panel-heading"><div><h2>Savings products</h2><p>Interest-bearing account templates for client wallets.</p></div></div>
      {savingsProducts.length === 0 ? <div className="empty-state compact-empty"><strong>No savings products yet</strong></div> : <div className="table-scroll"><table><thead><tr><th>Name</th><th>Currency</th><th>Rate</th><th>Min opening balance</th><th>Status</th><th></th></tr></thead><tbody>{savingsProducts.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.shortName}</small></td><td>{product.currencyCode}</td><td>{(product.nominalAnnualRateBps / 100).toFixed(2)}%</td><td>{formatMinor(product.minOpeningBalanceMinor, product.currencyCode)}</td><td><span className={`status ${product.active ? "up-to-date" : "review"}`}>{product.active ? "Active" : "Inactive"}</span></td><td><ArchiveToggleButton active={product.active} url={`/api/backoffice/savings-products/${product.id}`} /></td></tr>)}</tbody></table></div>}
      <CreateSavingsProductForm />
    </section>

    <section className="panel">
      <div className="panel-heading"><div><h2>Charges</h2><p>Fee and penalty templates applied to loans and savings.</p></div></div>
      {chargeDefinitions.length === 0 ? <div className="empty-state compact-empty"><strong>No charges defined yet</strong></div> : <div className="table-scroll"><table><thead><tr><th>Name</th><th>Applies to</th><th>Calculation</th><th>Amount</th><th>Penalty</th><th>Status</th><th></th></tr></thead><tbody>{chargeDefinitions.map((charge) => <tr key={charge.id}><td>{charge.name}</td><td>{charge.appliesTo}</td><td>{charge.calculationType}</td><td>{charge.calculationType === "FLAT" ? formatMinor(charge.amountMinor ?? 0n, charge.currencyCode) : `${((charge.percentageBps ?? 0) / 100).toFixed(2)}%`}</td><td>{charge.penalty ? "Yes" : "No"}</td><td><span className={`status ${charge.active ? "up-to-date" : "review"}`}>{charge.active ? "Active" : "Inactive"}</span></td><td><ArchiveToggleButton active={charge.active} url={`/api/backoffice/charge-definitions/${charge.id}`} /></td></tr>)}</tbody></table></div>}
      <CreateChargeDefinitionForm />
    </section>
  </main>;
}
