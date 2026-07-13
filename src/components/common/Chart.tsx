import { useEffect, useRef, useState } from 'react';

/**
 * Deterministic PRNG so the charts render identical bars/lines on every mount
 * (the prototype re-randomised on each draw). Seeded per variant.
 */
function seededRandoms(seed: number, count: number): number[] {
  const out: number[] = [];
  let s = seed >>> 0;
  for (let i = 0; i < count; i++) {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out.push(((t ^ (t >>> 14)) >>> 0) / 4294967296);
  }
  return out;
}

type Variant = 'mixed' | 'compare';

/** Measures its container width and redraws the SVG on resize. */
export function Chart({ variant }: { variant: Variant }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(el.clientWidth - 40, 200));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="chart-container" ref={ref}>
      {variant === 'mixed' ? <MixedChart w={width} /> : <CompareChart w={width} />}
    </div>
  );
}

/** Dashboard "30-Day Outlook": inflow/outflow bars + net cash flow line. */
function MixedChart({ w }: { w: number }) {
  const h = 200;
  const days = 30;
  const rIn = seededRandoms(101, days);
  const rOut = seededRandoms(202, days);
  const inflows = rIn.map((v) => 8 + v * 4);
  const outflows = rOut.map((v) => -(6 + v * 4));
  const net = inflows.map((v, i) => v + outflows[i]);

  const maxAbs = Math.max(...inflows, ...outflows.map(Math.abs)) * 1.1;
  const dx = w / (days - 1);
  const midY = h / 2;

  const netPath = net
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${i * dx},${midY - (v / maxAbs) * midY} `)
    .join('');

  return (
    <svg className="chart-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <line x1="0" y1={midY} x2={w} y2={midY} stroke="#d3cfc4" strokeWidth="1" />
      {[1, 2, 3].map((i) => (
        <g key={i}>
          <line x1="0" y1={midY - (i * midY) / 4} x2={w} y2={midY - (i * midY) / 4} stroke="#ebe9e0" strokeWidth="1" />
          <line x1="0" y1={midY + (i * midY) / 4} x2={w} y2={midY + (i * midY) / 4} stroke="#ebe9e0" strokeWidth="1" />
        </g>
      ))}
      {inflows.map((v, i) => {
        const barH = (v / maxAbs) * midY;
        return <rect key={`in${i}`} x={i * dx - dx * 0.3} y={midY - barH} width={dx * 0.6} height={barH} fill="#2f8a5c" opacity="0.45" />;
      })}
      {outflows.map((v, i) => {
        const barH = (Math.abs(v) / maxAbs) * midY;
        return <rect key={`out${i}`} x={i * dx - dx * 0.3} y={midY} width={dx * 0.6} height={barH} fill="#b8484a" opacity="0.45" />;
      })}
      <path d={netPath} fill="none" stroke="#8a6d3b" strokeWidth="2" />
      {net.map((v, i) => (
        <circle key={`n${i}`} cx={i * dx} cy={midY - (v / maxAbs) * midY} r="2.5" fill="#8a6d3b" />
      ))}
      <text x="6" y="14" fontFamily="JetBrains Mono" fontSize="9" fill="#8e92a3" letterSpacing="1">
        INFLOWS / OUTFLOWS · €M
      </text>
      <text x={w - 130} y="14" fontFamily="JetBrains Mono" fontSize="9" fill="#8a6d3b" letterSpacing="1">
        — NET CASH FLOW
      </text>
    </svg>
  );
}

/** Comparison "Daily Variance": prior (dashed) vs current (solid) line. */
function CompareChart({ w }: { w: number }) {
  const h = 200;
  const days = 30;
  const rp = seededRandoms(303, days);
  const rc = seededRandoms(404, days);
  const prior = rp.map((v) => 2 + v * 2);
  const current = prior.map((v, i) => v + (rc[i] - 0.5) * 1.2);

  const maxV = Math.max(...prior, ...current) * 1.2;
  const dx = w / (days - 1);

  const priorPath = prior.map((v, i) => `${i === 0 ? 'M' : 'L'}${i * dx},${h - (v / maxV) * h} `).join('');
  const currentPath = current.map((v, i) => `${i === 0 ? 'M' : 'L'}${i * dx},${h - (v / maxV) * h} `).join('');

  return (
    <svg className="chart-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {[1, 2, 3, 4].map((i) => (
        <line key={i} x1="0" y1={(i * h) / 5} x2={w} y2={(i * h) / 5} stroke="#ebe9e0" strokeWidth="1" />
      ))}
      <path d={priorPath} fill="none" stroke="#8e92a3" strokeWidth="1.5" strokeDasharray="4,3" />
      <path d={currentPath} fill="none" stroke="#8a6d3b" strokeWidth="2" />
      {current.map((v, i) => (
        <circle key={i} cx={i * dx} cy={h - (v / maxV) * h} r="2.5" fill="#8a6d3b" />
      ))}
      <text x="6" y="14" fontFamily="JetBrains Mono" fontSize="9" fill="#8e92a3" letterSpacing="1">
        - - - CW-2026-20 | ─── CW-2026-21
      </text>
    </svg>
  );
}
