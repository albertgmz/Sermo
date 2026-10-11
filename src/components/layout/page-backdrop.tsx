const COLUMNS = Array.from({ length: 17 }, (_, i) => i * 62.5);
const ROWS = [1, 42, 72, 92];

export function PageBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem] overflow-hidden"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_70%_at_50%_0%,color-mix(in_oklab,var(--primary)_16%,transparent),transparent_70%)]" />
      <svg
        aria-hidden="true"
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        className="absolute top-0 left-1/2 h-20 w-[min(100%,72rem)] -translate-x-1/2 text-primary opacity-60 [mask-image:linear-gradient(to_bottom,black_30%,transparent)] md:h-28"
      >
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        >
          {COLUMNS.map((x) => (
            <line
              key={x}
              x1={x}
              y1="0"
              x2={x + (500 - x) * 0.3}
              y2="100"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {ROWS.map((y) => (
            <line
              key={y}
              x1={y * 1.5}
              y1={y}
              x2={1000 - y * 1.5}
              y2={y}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
