"use client";

import { LoaderCircle, RefreshCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type ExportJob = Readonly<{
  id: string;
  scopeType: string;
  format: string;
  status: string;
  asOfDate: string;
  manifest: { loanCount?: number; datasetCounts?: Record<string, number> } | null;
  resultByteSize: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}>;

const scopeLabels: Record<string, string> = {
  SINGLE_LOAN: "Single loan",
  FILTERED: "Filtered set",
  PORTFOLIO: "Full portfolio",
};

function formatBytes(bytes: number | null) {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LoanExportsPanel({
  offices,
  products,
  initialJobs,
}: {
  offices: ReadonlyArray<{ id: string; name: string }>;
  products: ReadonlyArray<{ id: string; name: string }>;
  initialJobs: readonly ExportJob[];
}) {
  const [scopeType, setScopeType] = useState<"SINGLE_LOAN" | "FILTERED" | "PORTFOLIO">("PORTFOLIO");
  const [format, setFormat] = useState<"CSV_ZIP" | "JSON">("CSV_ZIP");
  const [submitting, setSubmitting] = useState(false);
  const [jobs, setJobs] = useState<readonly ExportJob[]>(initialJobs);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refreshJobs() {
    const response = await fetch("/api/loans/export-jobs");
    if (!response.ok) return;
    const result = await response.json().catch(() => null);
    if (result?.jobs) setJobs(result.jobs);
  }

  useEffect(() => {
    const hasActiveJob = jobs.some((job) => job.status === "PENDING" || job.status === "PROCESSING");
    if (!hasActiveJob) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(refreshJobs, 4_000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  async function requestExport(formData: FormData) {
    setSubmitting(true);
    const scopeParams: Record<string, unknown> = {};
    if (scopeType === "SINGLE_LOAN") {
      scopeParams.loanId = String(formData.get("loanId") || "");
    } else if (scopeType === "FILTERED") {
      const status = formData.get("status");
      const officeId = formData.get("officeId");
      const productId = formData.get("productId");
      const dateFrom = formData.get("dateFrom");
      const dateTo = formData.get("dateTo");
      if (status) scopeParams.status = status;
      if (officeId) scopeParams.officeId = officeId;
      if (productId) scopeParams.productId = productId;
      if (formData.get("arrears")) scopeParams.arrears = true;
      if (dateFrom) scopeParams.dateFrom = dateFrom;
      if (dateTo) scopeParams.dateTo = dateTo;
    }

    const response = await fetch("/api/loans/export-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scopeType, scopeParams, format, idempotencyKey: crypto.randomUUID() }),
    });
    const result = await response.json().catch(() => ({}));
    setSubmitting(false);
    if (!response.ok) { toast.error(result.error ?? "Export request failed"); return; }
    toast.success("Export queued — it will appear below once processed.");
    await refreshJobs();
  }

  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Request an export</h2>
            <p>Exports run asynchronously as a background job. Large portfolio exports may take a few minutes.</p>
          </div>
        </div>
        <form action={requestExport} className="entity-form compact-mapping">
          <fieldset>
            <legend>Scope</legend>
            <div className="form-row">
              <label>
                Scope
                <select name="scopeType" onChange={(event) => setScopeType(event.target.value as typeof scopeType)} value={scopeType}>
                  <option value="SINGLE_LOAN">Single loan</option>
                  <option value="FILTERED">Filtered set</option>
                  <option value="PORTFOLIO">Full portfolio</option>
                </select>
              </label>
              <label>
                Format
                <select name="format" onChange={(event) => setFormat(event.target.value as typeof format)} value={format}>
                  <option value="CSV_ZIP">CSV (zip package)</option>
                  <option value="JSON">JSON (nested package)</option>
                </select>
              </label>
            </div>
            {scopeType === "SINGLE_LOAN" ? (
              <label>
                Loan ID
                <input name="loanId" placeholder="Loan record ID (UUID)" required type="text" />
              </label>
            ) : null}
            {scopeType === "FILTERED" ? (
              <>
                <div className="form-row">
                  <label>
                    Status
                    <select defaultValue="" name="status">
                      <option value="">Any status</option>
                      <option value="APPROVED">Approved</option>
                      <option value="ACTIVE">Active</option>
                      <option value="IN_ARREARS">In arrears</option>
                      <option value="OVERPAID">Overpaid</option>
                      <option value="WRITTEN_OFF">Written off</option>
                      <option value="CLOSED">Closed</option>
                    </select>
                  </label>
                  <label>
                    Office
                    <select defaultValue="" name="officeId">
                      <option value="">Any office</option>
                      {offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
                    </select>
                  </label>
                  <label>
                    Product
                    <select defaultValue="" name="productId">
                      <option value="">Any product</option>
                      {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                    </select>
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    From date
                    <input name="dateFrom" type="date" />
                  </label>
                  <label>
                    To date
                    <input name="dateTo" type="date" />
                  </label>
                  <label className="check-row">
                    <input name="arrears" type="checkbox" /> In arrears only
                  </label>
                </div>
              </>
            ) : null}
          </fieldset>
          <div className="form-actions">
            <button className="invest-button" disabled={submitting} type="submit">
              {submitting ? <LoaderCircle className="spin" size={16} /> : null} Request export
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Export jobs</h2>
            <p>Your requested export packages, newest first.</p>
          </div>
          <button className="icon-action" onClick={refreshJobs} title="Refresh" type="button">
            <RefreshCcw size={14} />
          </button>
        </div>
        {jobs.length === 0 ? (
          <div className="empty-state compact-empty">
            <strong>No exports requested yet</strong>
            <p>Request an export above to generate an auditor-grade package.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Scope</th>
                  <th>Format</th>
                  <th>Status</th>
                  <th>Loans</th>
                  <th>Size</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      {new Date(job.createdAt).toLocaleString()}
                      <Link className="row-link" href={`/loans/exports/${job.id}`} aria-label={`Open export job ${job.id.slice(0, 8)}`} />
                    </td>
                    <td>{scopeLabels[job.scopeType] ?? job.scopeType}</td>
                    <td>{job.format === "CSV_ZIP" ? "CSV zip" : "JSON"}</td>
                    <td>
                      <span className={`status ${job.status === "COMPLETED" ? "up-to-date" : job.status === "FAILED" ? "in-arrears" : "review"}`}>
                        {job.status === "PENDING" || job.status === "PROCESSING" ? <LoaderCircle className="spin" size={12} /> : null} {job.status}
                      </span>
                      {job.errorMessage ? <p className="muted-text">{job.errorMessage}</p> : null}
                    </td>
                    <td>{job.manifest?.loanCount ?? "-"}</td>
                    <td>{formatBytes(job.resultByteSize)}</td>
                    <td style={{ position: "relative", zIndex: 1 }}>
                      {job.status === "COMPLETED" ? (
                        <a className="green-link" href={`/api/loans/export-jobs/${job.id}/download`} title="Download package">
                          Download
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
