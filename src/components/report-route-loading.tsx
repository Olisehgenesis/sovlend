import { LoaderCircle } from "lucide-react";

export default function ReportRouteLoading() {
  return (
    <main aria-busy="true" className="directory-page">
      <p className="report-route-loading" role="status">
        <LoaderCircle aria-hidden className="spin" size={18} />
        Loading report…
      </p>
    </main>
  );
}
