// ============================================================================
// The piece of work in progress on the forecast screen.
//
// Explaining a variance and answering a question both happen in the dock
// beside the grid, and both are interrupted constantly: a submitter goes to
// the dashboard to check a figure, opens Questions to read the rest of the
// thread, and comes back. The screen unmounts when they leave it, so what
// they were half way through writing left with it — the cell, the draft, and
// their place in a guided submit walk.
//
// It is kept per browser rather than on the forecast: an unsent sentence is
// not part of the submission, and nobody else should see it. One flow at a
// time, since there is one screen.
// ============================================================================
import { loadData, saveData } from '../storage/localStorage';

export interface FlowState {
  /** Which forecast the flow belongs to — a different one ignores it. */
  entity: string;
  week: string;
  templateId: string;
  /** The cell being explained or answered, as "cat-day". */
  key: string;
  /** `submitting` is the guided walk through every variance; `single` is one cell. */
  mode: 'submitting' | 'single';
  /** The commentary as typed, unsaved. */
  draft: string;
  /** The figure as typed, unsaved — a corrected number is half of an answer. */
  valueDraft: string;
  /** Whether that figure was actually edited, as opposed to merely shown. */
  valueDirty: boolean;
}

const KEY = 'forecastFlowInProgress';

function isFlowState(v: unknown): v is FlowState {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Partial<FlowState>;
  return (
    typeof f.entity === 'string' &&
    typeof f.week === 'string' &&
    typeof f.templateId === 'string' &&
    typeof f.key === 'string' &&
    (f.mode === 'submitting' || f.mode === 'single') &&
    typeof f.draft === 'string' &&
    typeof f.valueDraft === 'string' &&
    typeof f.valueDirty === 'boolean'
  );
}

/**
 * What was being written on this forecast, if anything. Returns null for a
 * flow saved against a different forecast — the one stored is the last one
 * touched, not one per entity.
 */
export function loadFlowState(entity: string, week: string, templateId: string): FlowState | null {
  const stored = loadData<unknown>(KEY, null);
  if (!isFlowState(stored)) return null;
  const mine =
    stored.entity === entity && stored.week === week && stored.templateId === templateId;
  return mine ? stored : null;
}

export function saveFlowState(state: FlowState): void {
  saveData(KEY, state);
}

/** Called when the flow ends — saved, submitted, or closed. */
export function clearFlowState(): void {
  saveData(KEY, null);
}
