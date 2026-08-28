import { useEffect, useRef, useState } from 'react';

// ============================================================================
// Data-driven SVG chart. Every chart in the app renders REAL forecast data
// through this component — the prototype's random-series generators are gone.
// Supports bar / line / area series, negative values, gaps (null = the series
// has no value for that slot, e.g. days beyond the prior horizon), hover
// tooltips and a compact legend, in the app's mono/muted visual style.
// ============================================================================

/**
 * Palette shared by all charts. These mirror the design tokens in index.css
 * (--accent / --green / --red / --blue / --n-400) — SVG attributes cannot read
 * a CSS custom property here, so the values are duplicated deliberately and
 * must be changed together with the token block.
 */
export const CHART_COLORS = {
  accent: '#573027',
  green: '#3f6223',
  red: '#9c2f22',
  blue: '#23599c',
  muted: '#9a8880',
} as const;

export interface ChartSeries {
  label: string;
  /** One value per x slot; null renders a gap. */
  values: (number | null)[];
  color: string;
  kind: 'bar' | 'line' | 'area';
  /** Dashed stroke (line/area outline). */
  dashed?: boolean;
}

interface ChartProps {
  /** X-axis slot labels (all series must have this length). */
  labels: string[];
  series: ChartSeries[];
  /** Unit suffix for tooltips / axis labels, e.g. "k". */
  unit?: string;
  height?: number;
  /**
   * Stack bar series in one column per slot rather than standing them side by
   * side. Positives stack up from the baseline and negatives down, so an
   * inflow and an outflow bar share an x position and their heights read as
   * one gross-flow column.
   */
  stacked?: boolean;
  /**
   * Called with the slot index when a column is clicked. Adds a full-height
   * hit area per slot, so the whole column is the target rather than the few
   * pixels of a bar.
   *
   * `additive` is true when the click was made with Ctrl (or Cmd) held, which
   * means "add this period to the ones already chosen" rather than "replace
   * them" — the same gesture a spreadsheet uses for a multiple selection.
   */
  onPointClick?: (index: number, additive: boolean) => void;
  /**
   * Called with the slot index on a DOUBLE click. A single click filters the
   * page to that period; opening the detail behind it is the deliberate
   * second click, so the two never fight over the same gesture — the single
   * click is therefore held back briefly to see whether a second one lands.
   */
  onPointDoubleClick?: (index: number) => void;
  /** Slots currently selected by a cross-filter, drawn as standing columns. */
  activeIndexes?: number[];
  /**
   * Slots worth marking out on the axis — Fridays on a daily horizon, which
   * are the week-to-week reference point. One flag per label.
   */
  emphasis?: boolean[];
  /**
   * A number printed above the column, per slot; null leaves the slot bare.
   *
   * Used for the week-end figures on the marked slots: a Friday's net is the
   * number people read off a cash-flow chart, and reading it off the axis by
   * eye is a guess to the nearest ten thousand.
   */
  slotValues?: (number | null)[];
}

/** How long a single click waits for a second one before acting. */
const DOUBLE_CLICK_MS = 220;

// Left and bottom leave room for axis labels set at a readable weight and
// size — at 9px light grey they were decoration you had to lean in to read.
// Left gutter for the y-axis values. Sized to the widest label the axis
// actually prints ("-105k" at 10px mono is ~34px), not to a round number —
// 60px left a visible empty channel between the values and the plot.
const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 20;
const PAD_B = 30;

function fmtAxis(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${Math.round(v / 1000)}k`;
  if (abs >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return `${Math.round(v)}`;
}

const fmtVal = (v: number, unit: string) => `${Math.round(v).toLocaleString()}${unit}`;

/** Measures the box the plot is drawn into and redraws the SVG on resize. */
export function Chart({
  labels,
  series,
  unit = '',
  height = 200,
  stacked = false,
  onPointClick,
  onPointDoubleClick,
  activeIndexes,
  emphasis,
  slotValues,
}: ChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  // The box the plot is actually drawn into, measured rather than assumed.
  // The viewBox is written in these same numbers, so one unit is one pixel
  // and nothing in the chart is scaled non-uniformly: guessing either side
  // of it (the container's width minus a hardcoded padding, the `height`
  // prop minus nothing) left the SVG stretched horizontally and squashed
  // vertically by whatever the difference happened to be.
  const [box, setBox] = useState({ w: 600, h: height });
  // Pending single click, held for a moment in case a double click follows.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      // A chart inside a folded panel measures zero; the floors keep it
      // drawable until it is opened and measured for real.
      setBox({ w: Math.max(Math.round(r.width), 240), h: Math.max(Math.round(r.height), 120) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
    },
    [],
  );

  const handleClick = (i: number, additive: boolean) => {
    if (!onPointClick) return;
    // With no double-click handler there is nothing to wait for.
    if (!onPointDoubleClick) {
      onPointClick(i, additive);
      return;
    }
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      onPointClick(i, additive);
    }, DOUBLE_CLICK_MS);
  };

  const handleDoubleClick = (i: number) => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    onPointDoubleClick?.(i);
  };

  const n = labels.length;
  const w = box.w;
  const h = box.h;
  const plotW = w - PAD_L - PAD_R;
  const plotH = h - PAD_T - PAD_B;

  const barSeries = series.filter((s) => s.kind === 'bar');
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  // Stacked columns reach further than any single bar in them, so the axis has
  // to be scaled against the per-slot totals rather than the raw values.
  const stackExtent: number[] = [];
  if (stacked) {
    for (let i = 0; i < n; i++) {
      let up = 0;
      let down = 0;
      for (const s of barSeries) {
        const v = s.values[i];
        if (v === null || v === undefined) continue;
        if (v >= 0) up += v;
        else down += v;
      }
      stackExtent.push(up, down);
    }
  }
  let min = Math.min(0, ...all, ...stackExtent);
  let max = Math.max(0, ...all, ...stackExtent);
  if (min === max) max = min + 1;
  const span = max - min;
  if (min < 0) min -= span * 0.06;
  if (max > 0) max += span * 0.06;

  const y = (v: number) => PAD_T + ((max - v) / (max - min)) * plotH;
  const slotW = plotW / Math.max(n, 1);
  const x = (i: number) => PAD_L + (i + 0.5) * slotW;

  // Stacked: one column per slot. Grouped: one bar per series, side by side.
  const barW = stacked ? slotW * 0.5 : (slotW * 0.55) / Math.max(barSeries.length, 1);
  /** Running baseline per slot while stacking, kept per sign. */
  const stackTops = new Map<string, number>();
  const stackBase = (i: number, positive: boolean): number => {
    const key = `${i}:${positive}`;
    return stackTops.get(key) ?? 0;
  };
  const pushStack = (i: number, positive: boolean, v: number) => {
    stackTops.set(`${i}:${positive}`, stackBase(i, positive) + v);
  };

  /** Path segments for a line/area series, split at null gaps. */
  const segments = (vals: (number | null)[]): { i: number; v: number }[][] => {
    const out: { i: number; v: number }[][] = [];
    let cur: { i: number; v: number }[] = [];
    vals.forEach((v, i) => {
      if (v === null) {
        if (cur.length) out.push(cur);
        cur = [];
      } else {
        cur.push({ i, v });
      }
    });
    if (cur.length) out.push(cur);
    return out;
  };

  const gridVals = [0, 1, 2, 3, 4].map((i) => min + ((max - min) * i) / 4);
  // Minimum horizontal room per x-axis label. Sized for the UI face: at 64px
  // a stepped label and a forced emphasis label (Fridays) could touch once the
  // wider Poppins glyphs were in, which read as one smudged date.
  const labelStep = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(plotW / 78))));

  return (
    <div className="chart-container" style={{ height: height + 40 }}>
      <svg ref={svgRef} className="chart-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {/* Marked slots (Fridays on a daily horizon) get a standing band, so
            the week-to-week reference points are findable without counting
            columns. Drawn first — everything else sits on top of it. */}
        {emphasis?.map((on, i) =>
          on ? (
            <rect
              key={`em${i}`}
              className="chart-emphasis-band"
              x={x(i) - slotW / 2}
              y={PAD_T}
              width={slotW}
              height={plotH}
            />
          ) : null,
        )}
        {/* The periods a cross-filter has selected. */}
        {(activeIndexes ?? [])
          .filter((i) => i >= 0 && i < n)
          .map((i) => (
            <rect
              key={`active${i}`}
              className="chart-active-band"
              x={x(i) - slotW / 2}
              y={PAD_T}
              width={slotW}
              height={plotH}
            />
          ))}
        {/* The figure that belongs to a marked slot, printed where it can be
            read rather than estimated off the axis. */}
        {slotValues?.map((v, i) =>
          v === null || v === undefined ? null : (
            <text
              key={`sv${i}`}
              className="chart-slot-value"
              x={x(i)}
              y={PAD_T - 3}
              textAnchor="middle"
            >
              {fmtAxis(v)}
            </text>
          ),
        )}
        {/* horizontal gridlines + axis values */}
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} y1={y(v)} x2={w - PAD_R} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
            <text
              x={PAD_L - 6}
              y={y(v) + 3.5}
              textAnchor="end"
              className="chart-axis-label"
            >
              {fmtAxis(v)}
            </text>
          </g>
        ))}
        {/* zero baseline */}
        {min < 0 && max > 0 && (
          <line x1={PAD_L} y1={y(0)} x2={w - PAD_R} y2={y(0)} stroke="var(--border-strong)" strokeWidth="1" />
        )}

        {/* bars */}
        {barSeries.map((s, si) =>
          s.values.map((v, i) => {
            if (v === null || v === 0) return null;
            if (stacked) {
              // Sit this bar on top of whatever the same-signed bars before it
              // already occupy, so one column shows the gross flow.
              const from = stackBase(i, v >= 0);
              pushStack(i, v >= 0, v);
              const top = Math.min(y(from), y(from + v));
              const bh = Math.max(Math.abs(y(from + v) - y(from)), 1);
              return (
                <rect
                  key={`${si}-${i}`}
                  x={x(i) - barW / 2}
                  y={top}
                  width={barW}
                  height={bh}
                  fill={s.color}
                  opacity="0.6"
                >
                  <title>{`${labels[i]} · ${s.label}: ${fmtVal(v, unit)}`}</title>
                </rect>
              );
            }
            const x0 = x(i) - (barSeries.length * barW) / 2 + si * barW;
            const y0 = Math.min(y(0), y(v));
            const bh = Math.max(Math.abs(y(v) - y(0)), 1);
            return (
              <rect key={`${si}-${i}`} x={x0} y={y0} width={barW * 0.92} height={bh} fill={s.color} opacity="0.45">
                <title>{`${labels[i]} · ${s.label}: ${fmtVal(v, unit)}`}</title>
              </rect>
            );
          }),
        )}

        {/* areas under line series flagged as area */}
        {series
          .filter((s) => s.kind === 'area')
          .map((s, si) =>
            segments(s.values).map((seg, gi) => {
              const path =
                seg.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i)},${y(p.v)}`).join(' ') +
                ` L${x(seg[seg.length - 1].i)},${y(Math.max(min, 0))} L${x(seg[0].i)},${y(Math.max(min, 0))} Z`;
              return <path key={`a${si}-${gi}`} d={path} fill={s.color} opacity="0.14" />;
            }),
          )}

        {/* lines (and area outlines) */}
        {series
          .filter((s) => s.kind === 'line' || s.kind === 'area')
          .map((s, si) =>
            segments(s.values).map((seg, gi) => (
              <path
                key={`l${si}-${gi}`}
                d={seg.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i)},${y(p.v)}`).join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeDasharray={s.dashed ? '5,4' : undefined}
              />
            )),
          )}

        {/* line vertices with tooltips */}
        {series
          .filter((s) => s.kind === 'line' || s.kind === 'area')
          .map((s, si) =>
            s.values.map((v, i) =>
              v === null ? null : (
                <circle key={`p${si}-${i}`} cx={x(i)} cy={y(v)} r="2.4" fill={s.color}>
                  <title>{`${labels[i]} · ${s.label}: ${fmtVal(v, unit)}`}</title>
                </circle>
              ),
            ),
          )}

        {/* Click targets: the whole column, so a thin bar or a single line
            vertex is not the only thing a pointer can land on. Sitting on top
            of the marks, each one carries the readout for its whole slot —
            more than the per-mark tooltips it covers. */}
        {onPointClick &&
          labels.map((label, i) => (
            <rect
              key={`hit${i}`}
              className="chart-hit"
              x={x(i) - slotW / 2}
              y={PAD_T}
              width={slotW}
              height={plotH}
              fill="transparent"
              onClick={(e) => handleClick(i, e.ctrlKey || e.metaKey)}
              onDoubleClick={() => handleDoubleClick(i)}
            >
              <title>
                {[
                  label,
                  ...series.map((s) =>
                    s.values[i] === null || s.values[i] === undefined
                      ? `${s.label}: —`
                      : `${s.label}: ${fmtVal(s.values[i] as number, unit)}`,
                  ),
                ].join('\n')}
              </title>
            </rect>
          ))}

        {/* x labels — a marked slot (Friday) always gets one, whatever the
            thinning step, since it is the label you are looking for. A stepped
            label that lands right beside a marked one is dropped instead: two
            dates a few pixels apart run together and read as one. */}
        {labels.map((label, i) =>
          emphasis?.[i] ||
          (i % labelStep === 0 && !emphasis?.[i - 1] && !emphasis?.[i + 1]) ? (
            <text
              key={i}
              x={x(i)}
              y={h - 9}
              textAnchor="middle"
              className={`chart-axis-label${emphasis?.[i] ? ' chart-axis-marked' : ''}`}
            >
              {label}
            </text>
          ) : null,
        )}
      </svg>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.label} className="chart-legend-item">
            <span
              className="legend-swatch"
              style={{
                background: s.kind === 'bar' ? s.color : 'transparent',
                opacity: s.kind === 'bar' ? 0.55 : 1,
                borderTop: s.kind !== 'bar' ? `2px ${s.dashed ? 'dashed' : 'solid'} ${s.color}` : undefined,
                height: s.kind !== 'bar' ? 0 : undefined,
              }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
