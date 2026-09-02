import { Sparkles } from "lucide-react";

export default function ReportsPage() {
  return (
    <main className="directory-page">
      <header className="directory-header">
        <div><p className="eyebrow">Portfolio insight</p><h1>Reports</h1><p>Operational and financial reports across the portfolio.</p></div>
      </header>
      <div className="empty-state"><Sparkles size={28} /><strong>Not built yet</strong><p>Report exports aren&apos;t wired to data yet &mdash; the dashboard and CSV exports on Clients/Loans cover the basics for now.</p></div>
    </main>
  );
}
