// Static letterhead for JUMPSTART Africa Investment Services LTD. Deliberately hardcoded
// (rather than sourced from the Organization row) since the registered legal-entity name and
// contact details on a printed financial statement are fixed company letterhead facts, not
// per-tenant configuration.
export function OrganizationLetterhead() {
  return (
    <header className="statement-letterhead">
      <div>
        <h2>JUMPSTART Africa Investment Services LTD</h2>
        <p>Head Office: Plot 772, Habib Plaza, P.O Box 130716, Kampala</p>
        <p>Email: info@jumpstartafrica.org · www.jumpstartafrica.org</p>
        <p>+256 772 883 033 · +256 772 488 230</p>
      </div>
      <div className="statement-letterhead-title">
        <span>Statement date</span>
        <strong>{new Date().toLocaleDateString("en-UG", { day: "numeric", month: "long", year: "numeric" })}</strong>
      </div>
    </header>
  );
}
