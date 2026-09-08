"use client";

import { Printer } from "lucide-react";

/** Triggers the browser print dialog for the current page. Paired with the `@media print`
 * rules in globals.css that hide the sidebar/header/breadcrumbs and let `.statement-sheet`
 * fill the page, so this renders the client statement as a clean, letterhead-only printout. */
export function PrintStatementButton() {
  return (
    <button className="invest-button no-print" onClick={() => window.print()} type="button">
      <Printer size={16} /> Print statement
    </button>
  );
}
