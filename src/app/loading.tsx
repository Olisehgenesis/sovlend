export default function Loading() {
  return (
    <main className="route-state" aria-live="polite" aria-busy="true">
      <div className="orbit-loader" role="presentation">
        <span className="orbit-sun" />
        <span className="orbit-ring orbit-ring--1"><span className="orbit-planet" /></span>
        <span className="orbit-ring orbit-ring--2"><span className="orbit-planet" /></span>
        <span className="orbit-ring orbit-ring--3"><span className="orbit-planet" /></span>
      </div>
      <div className="loading-lines"><span /><span /><span /></div>
      <p>Loading workspace data…</p>
    </main>
  );
}