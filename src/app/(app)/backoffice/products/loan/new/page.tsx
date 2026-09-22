import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { CreateLoanProductForm } from "@/components/product-forms";
import { auth } from "@/lib/auth";
import { canManageProducts } from "@/lib/can-manage-products";

export default async function NewLoanProductPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const { allowed } = await canManageProducts(session);
  if (!allowed) redirect("/");

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Backoffice", href: "/backoffice" },
          { label: "Products", href: "/backoffice/products" },
          { label: "New loan product" },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Product catalog</p>
          <h1>New loan product</h1>
          <p>Create a credit template used when pricing, approving and disbursing loans.</p>
        </div>
        <Link className="secondary-action" href="/backoffice/products">
          Products
        </Link>
      </header>
      <section className="panel form-panel">
        <div className="panel-heading">
          <div>
            <h2>Loan product</h2>
            <p>Existing loan accounts keep the terms they were originated with.</p>
          </div>
        </div>
        <CreateLoanProductForm />
      </section>
    </main>
  );
}
