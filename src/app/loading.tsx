export default function Loading() {
  return <main className="route-state" aria-live="polite" aria-busy="true"><div className="loading-mark" /><div className="loading-lines"><span /><span /><span /></div><p>Loading workspace data…</p></main>;
}