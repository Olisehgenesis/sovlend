export function BalanceSpark({ points }: { points: bigint[] }) {
  if (points.length < 2) return null;
  const values = points.map((point) => Number(point));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 280;
  const height = 96;
  const coords = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - 8 - ((value - min) / span) * (height - 20);
    return { x, y };
  });
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;

  return (
    <svg className="portal-spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Savings over the last six months">
      <path d={area} />
      <path d={line} />
    </svg>
  );
}
