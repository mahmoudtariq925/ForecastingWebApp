import { useEffect, useMemo, useState } from 'react';

// ============================================================================
// Diverging conditional formatting for the numeric forecast grids.
//
// The midpoint is always fixed at 0 so the colour tells you the SIGN at a
// glance; the extremes come from the values actually on screen, recomputed
// whenever the visible data changes (country / period / template filters all
// swap `values`, so this follows automatically).
//
// Saturation is deliberately low — this is a dense numeric grid, so the fill
// sits behind the digits rather than competing with them, and the text colour
// is never touched.
// ============================================================================

export interface HeatScale {
  /** Most negative visible value (<= 0). */
  min: number;
  /** Most positive visible value (>= 0). */
  max: number;
  /**
   * The visible value CLOSEST to zero on each side — the foot of the ramp.
   *
   * Running the ramp from zero shaded a band of similar numbers uniformly:
   * eleven countries between 8.6k and 13k all sat at 70–100% of the scale, so
   * every cell was green and the biggest one did not stand out from the
   * smallest. Anchoring the foot at the band's own minimum means the ramp
   * spends its whole range on the differences that are actually there.
   */
  posFloor: number;
  negFloor: number;
}

export const NEUTRAL_SCALE: HeatScale = { min: 0, max: 0, posFloor: 0, negFloor: 0 };

/**
 * How hard the fill is allowed to push, from the floor that keeps a small
 * value visible to the peak at the end of the scale.
 *
 * Two settings, because the same colour rule serves two very different
 * surfaces. A forecast grid is 240 cells of dense type where the fill sits
 * BEHIND the digits; a summary matrix is a dozen rows where the colour is
 * doing the reading for you, and at grid strength it washed out to nothing.
 */
export interface HeatIntensity {
  /** Opacity of the faintest cell that is shaded at all. */
  min: number;
  /** Peak background opacity at the extremes of the scale. */
  max: number;
  /**
   * Fraction of the band a value has to reach before it is shaded at all.
   *
   * Without it every non-zero cell carried a tint, so a grid of ordinary
   * numbers was uniformly coloured and the week's actual peaks — the whole
   * reason for the colour — were indistinguishable from the noise around
   * them. Below the threshold a cell keeps the surface colour, exactly like
   * zero does.
   */
  threshold: number;
}

/** Dense numeric grids: only the peaks of a line are worth colouring. */
export const SUBTLE_HEAT: HeatIntensity = { min: 0.05, max: 0.28, threshold: 0.25 };
/** Summary tables: the colour is the point, so it has to be legible. */
export const STRONG_HEAT: HeatIntensity = { min: 0.07, max: 0.5, threshold: 0.15 };

// Matches --green / --red in the design system.
const POSITIVE_RGB = '63, 98, 35';
const NEGATIVE_RGB = '156, 47, 34';

/**
 * Build a scale from the values currently on screen: the extremes of each
 * sign, and the smallest non-zero value on each side. Zero stays the midpoint
 * — the colour still says the SIGN at a glance — but the intensity now says
 * where a value sits within its own band rather than how far it is from zero.
 */
export function heatScaleFrom(values: Iterable<number>): HeatScale {
  let min = 0;
  let max = 0;
  let posFloor = Infinity;
  let negFloor = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v) || v === 0) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    if (v > 0 && v < posFloor) posFloor = v;
    if (v < 0 && v > negFloor) negFloor = v;
  }
  return {
    min,
    max,
    posFloor: Number.isFinite(posFloor) ? posFloor : 0,
    negFloor: Number.isFinite(negFloor) ? negFloor : 0,
  };
}

/**
 * Background fill for one cell, or undefined for zero / no usable scale —
 * which leaves the cell its normal background, so **zero is always the
 * surface colour** and the ramp runs from there out to green at the top of
 * the band and red at the bottom of it.
 */
export function heatColor(
  value: number,
  scale: HeatScale,
  intensity: HeatIntensity = SUBTLE_HEAT,
): string | undefined {
  if (!Number.isFinite(value) || value === 0) return undefined;
  const extreme = value > 0 ? scale.max : scale.min;
  const floor = value > 0 ? scale.posFloor : scale.negFloor;
  // Nothing to be a fraction of: the whole band is on the other side of zero.
  if (value > 0 ? extreme <= 0 : extreme >= 0) return undefined;
  // Where this value sits between the band's smallest and largest, rather than
  // between zero and its largest.
  const range = Math.abs(extreme) - Math.abs(floor);
  const t = range <= 0 ? 0 : Math.min((Math.abs(value) - Math.abs(floor)) / range, 1);
  if (t <= intensity.threshold) return undefined;
  // Rescaled so the first shaded cell starts at `min` rather than jumping
  // straight to a mid tint, and eased so the top of the band stands out.
  const shaped = (t - intensity.threshold) / (1 - intensity.threshold);
  const alpha = intensity.min + Math.pow(shaped, 1.3) * (intensity.max - intensity.min);
  return `rgba(${value > 0 ? POSITIVE_RGB : NEGATIVE_RGB}, ${alpha.toFixed(3)})`;
}

/**
 * Debounced mirror of a value. Keeps scale recomputation off the critical
 * path while the user types in the grid or flicks between filters — the
 * numbers update instantly, the colour scale settles a moment later.
 */
export function useDebounced<T>(value: T, delay = 120): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return settled;
}

/** Debounced scale over a set of visible numbers. */
export function useHeatScale(collect: () => number[], deps: unknown[]): HeatScale {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const values = useMemo(collect, deps);
  const debounced = useDebounced(values);
  return useMemo(() => heatScaleFrom(debounced), [debounced]);
}

/**
 * One independent scale per band of values — a band being a row, a column or
 * a section, whatever the caller wants shaded against itself rather than
 * against the whole grid. Same debounce as `useHeatScale`, and a fixed hook
 * count however many bands there are.
 */
export function useHeatScales(collect: () => number[][], deps: unknown[]): HeatScale[] {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bands = useMemo(collect, deps);
  const debounced = useDebounced(bands);
  return useMemo(() => debounced.map(heatScaleFrom), [debounced]);
}
