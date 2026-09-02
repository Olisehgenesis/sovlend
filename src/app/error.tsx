"use client";

import { CircleAlert, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <main className="route-state error-state"><CircleAlert size={30} /><h1>This screen could not load</h1><p>Your data was not changed. Retry the request, or return to the overview if the problem continues.</p><div className="header-actions"><button className="invest-button" onClick={reset}><RotateCcw size={16} /> Try again</button><Link className="secondary-action" href="/">Return to overview</Link></div>{error.digest ? <small>Reference: {error.digest}</small> : null}</main>;
}