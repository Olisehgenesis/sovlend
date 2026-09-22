import { Plus } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ArchiveToggleButton } from "@/components/archive-toggle-button";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CreateChargeDefinitionForm, CreateSavingsProductForm } from "@/components/product-forms";
import { LiveSearchInput } from "@/components/live-search-input";
import { TableRowLink } from "@/components/table-row-link";
import { auth } from "@/lib/auth";
import { canManageProducts } from "@/lib/can-manage-products";
import { prisma } from "@/lib/prisma";
import {
  formatLoanProductTerm,
  groupLoanProductsByTerm,
  loanProductMatchesQuery,
} from "@/modules/lending/domain/loan-product-catalog";
import { formatMonthlyPercent } from "@/modules/lending/domain/monthly-rate";
import { formatMinor } from "@/modules/money/domain/format-minor";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const { allowed, organizationId } = await canManageProducts(session);
  if (!allowed || !organizationId) redirect("/");

  const query = (await searchParams).query?.trim() ?? "";
  const [loanProducts, savingsProducts, chargeDefinitions, activeLoanCounts] = await Promise.all([
    prisma.loanProduct.findMany({ where: { organizationId } }),
    prisma.savingsProduct.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    prisma.chargeDefinition.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    prisma.loan.groupBy({
      by: ["productId"],
      where: { product: { organizationId }, status: { in: ["ACTIVE", "IN_ARREARS"] } },
      _count: { _all: true },
    }),
  ]);
  const activeLoansByProduct = new Map(activeLoanCounts.map((row) => [row.productId, row._count._all]));

  const matchingLoanProducts = query
    ? loanProducts.filter((product) => loanProductMatchesQuery(product, query))
    : loanProducts;
  let productNumber = 0;
  const catalogSections = groupLoanProductsByTerm(matchingLoanProducts).map((group) => ({
    label: group.label,
    products: group.products.map((product) => {
      productNumber += 1;
      return { product, number: productNumber };
    }),
  }));

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Backoffice", href: "/backoffice" }, { label: "Products" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Product catalog</p>
          <h1>Products</h1>
          <p>Loan, savings and charge templates used when opening client accounts.</p>
        </div>
        <Link className="secondary-action" href="/backoffice">
          Backoffice
        </Link>
      </header>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Loan products</h2>
            <p>
              {matchingLoanProducts.length.toLocaleString()}
              {query ? " matching" : ""} templates · grouped by repayment cycle
            </p>
          </div>
          <Link className="invest-button" href="/backoffice/products/loan/new">
            <Plus size={16} /> Add
          </Link>
        </div>
        <div className="directory-toolbar">
          <LiveSearchInput placeholder="Search loan product, code or term" />
        </div>
        {matchingLoanProducts.length === 0 ? (
          <div className="empty-state compact-empty">
            <strong>{query ? "No loan products match" : "No loan products yet"}</strong>
            <p>
              {query
                ? "Try another name, short code, or term such as weekly."
                : "Add a loan product to start originating against it."}
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows loan-product-catalog">
              <thead>
                <tr>
                  <th className="row-index">No.</th>
                  <th>Product</th>
                  <th>Code</th>
                  <th>Term</th>
                  <th className="numeric">Principal range</th>
                  <th className="numeric">Interest / month</th>
                  <th className="numeric">Monitoring / month</th>
                  <th className="numeric">Active loans</th>
                  <th>Status</th>
                  <th className="table-actions" />
                </tr>
              </thead>
              <tbody>
                {catalogSections.flatMap((group) => [
                  <tr className="catalog-group-row" key={`group-${group.label}`}>
                    <td className="row-index" />
                    <td colSpan={9}>{group.label}</td>
                  </tr>,
                  ...group.products.map(({ product, number }) => {
                    const href = `/backoffice/products/loan/${product.id}`;
                    const label = `Open loan product ${product.name}`;
                    return (
                      <tr key={product.id}>
                        <td className="row-index">
                          {number}
                          <TableRowLink href={href} label={label} />
                        </td>
                        <td>
                          <strong>{product.name}</strong>
                          <TableRowLink href={href} label={label} primary />
                        </td>
                        <td className="mono">
                          {product.shortName}
                          <TableRowLink href={href} label={label} />
                        </td>
                        <td>
                          {formatLoanProductTerm(product.repaymentCount, product.repaymentFrequency)}
                          <TableRowLink href={href} label={label} />
                        </td>
                        <td className="numeric">
                          {formatMinor(product.principalMinMinor, product.denominationCurrency)} –{" "}
                          {formatMinor(product.principalMaxMinor, product.denominationCurrency)}
                          <TableRowLink href={href} label={label} />
                        </td>
                        <td className="numeric">
                          {formatMonthlyPercent(product.annualRateBps)}%
                          <TableRowLink href={href} label={label} />
                        </td>
                        <td className="numeric">
                          {formatMonthlyPercent(product.monitoringFeeAnnualRateBps)}%
                          <TableRowLink href={href} label={label} />
                        </td>
                        <td className="numeric">
                          {(activeLoansByProduct.get(product.id) ?? 0).toLocaleString()}
                          <TableRowLink href={href} label={label} />
                        </td>
                        <td>
                          <span className={`status ${product.active ? "up-to-date" : "review"}`}>
                            {product.active ? "Active" : "Inactive"}
                          </span>
                          <TableRowLink href={href} label={label} />
                        </td>
                        <td className="table-actions">
                          <ArchiveToggleButton active={product.active} url={`/api/backoffice/loan-products/${product.id}`} />
                        </td>
                      </tr>
                    );
                  }),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Savings products</h2>
            <p>Interest-bearing account templates for client wallets.</p>
          </div>
        </div>
        {savingsProducts.length === 0 ? (
          <div className="empty-state compact-empty">
            <strong>No savings products yet</strong>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Currency</th>
                  <th>Rate</th>
                  <th>Min opening balance</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {savingsProducts.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <strong>{product.name}</strong>
                      <small>{product.shortName}</small>
                      <Link aria-label={`Open savings product ${product.name}`} className="row-link" href={`/backoffice/products/savings/${product.id}`} />
                    </td>
                    <td>{product.currencyCode}</td>
                    <td>{(product.nominalAnnualRateBps / 100).toFixed(2)}%</td>
                    <td>{formatMinor(product.minOpeningBalanceMinor, product.currencyCode)}</td>
                    <td>
                      <span className={`status ${product.active ? "up-to-date" : "review"}`}>{product.active ? "Active" : "Inactive"}</span>
                    </td>
                    <td>
                      <ArchiveToggleButton active={product.active} url={`/api/backoffice/savings-products/${product.id}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <CreateSavingsProductForm />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Charges</h2>
            <p>Fee and penalty templates applied to loans and savings.</p>
          </div>
        </div>
        {chargeDefinitions.length === 0 ? (
          <div className="empty-state compact-empty">
            <strong>No charges defined yet</strong>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Applies to</th>
                  <th>Calculation</th>
                  <th>Amount</th>
                  <th>Penalty</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {chargeDefinitions.map((charge) => (
                  <tr key={charge.id}>
                    <td>
                      {charge.name}
                      <Link aria-label={`Open charge definition ${charge.name}`} className="row-link" href={`/backoffice/products/charge/${charge.id}`} />
                    </td>
                    <td>{charge.appliesTo}</td>
                    <td>{charge.calculationType}</td>
                    <td>
                      {charge.calculationType === "FLAT"
                        ? formatMinor(charge.amountMinor ?? 0n, charge.currencyCode)
                        : `${((charge.percentageBps ?? 0) / 100).toFixed(2)}%`}
                    </td>
                    <td>{charge.penalty ? "Yes" : "No"}</td>
                    <td>
                      <span className={`status ${charge.active ? "up-to-date" : "review"}`}>{charge.active ? "Active" : "Inactive"}</span>
                    </td>
                    <td>
                      <ArchiveToggleButton active={charge.active} url={`/api/backoffice/charge-definitions/${charge.id}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <CreateChargeDefinitionForm />
      </section>
    </main>
  );
}
