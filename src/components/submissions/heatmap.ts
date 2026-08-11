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
}

export const NEUTRAL_SCALE: HeatScale = { min: 0, max: 0 };

/** Peak background opacity at the extremes of the scale. */
const MAX_ALPHA = 0.18;
/** Floor so a non-zero value is never completely invisible. */
const MIN_ALPHA = 0.03;

// Matches --green / --red in the design system.
const POSITIVE_RGB = '47, 138, 92';
const NEGATIVE_RGB = '184, 72, 74';

/** Build a scale from the values currently on screen. Zero is the midpoint. */
export function heatScaleFrom(values: Iterable<number>): HeatScale {
  let min = 0;
  let max = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/**
 * Background fill for one cell, or undefined for zero / no usable scale
 * (which leaves the cell its normal background).
 */
export function heatColor(value: number, scale: HeatScale): string | undefined {
  if (!Number.isFinite(value) || value === 0) return undefined;
  if (value > 0) {
    if (scale.max <= 0) return undefined;
    const t = Math.min(value / scale.max, 1);
    return `rgba(${POSITIVE_RGB}, ${(MIN_ALPHA + t * (MAX_ALPHA - MIN_ALPHA)).toFixed(3)})`;
  }
  if (scale.min >= 0) return undefined;
  const t = Math.min(value / scale.min, 1);
  return `rgba(${NEGATIVE_RGB}, ${(MIN_ALPHA + t * (MAX_ALPHA - MIN_ALPHA)).toFixed(3)})`;
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
