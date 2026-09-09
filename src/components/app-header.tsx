import Link from "next/link";

import { AccountMenu } from "./account-menu";

// Primary navigation lives entirely in AppSidebar (see src/components/app-sidebar.tsx).
// This header is intentionally nav-free: it only surfaces workspace/office context and the
// account menu, so there is a single source of truth for routes instead of two hand-maintained
// nav trees drifting apart.
export function AppHeader({
  workspaceName,
  officeName,
}: {
  workspaceName?: string | null;
  officeName?: string | null;
}) {
  return (
    <header className="topbar app-header">
      <div className="topbar-context">
        <Link className="topbar-context-link" href="/">
          <strong>{workspaceName ?? "SovLend"}</strong>
        </Link>
        {officeName ? <small>{officeName}</small> : null}
      </div>
      <AccountMenu />
    </header>
  );
}
