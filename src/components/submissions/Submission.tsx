import { useMemo, useState, type ClipboardEvent } from 'react';
import { TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { ForecastGrid } from './ForecastGrid';
import type { GridValues } from './gridMath';
import { generateGridValues, seedFor } from '../../data/mockData';
import { loadSettings, loadSubmission, saveSubmission } from '../../storage/localStorage';
import type { Settings, Submission as SubmissionModel } from '../../types';
import type { ModalId } from '../../types/nav';
import type { VarianceDetail } from '../common/AppModals';
import { DEFAULT_SETTINGS } from '../settings/defaults';

const CYCLE_ID = 'CW-2026-21';
const ENTITY = 'NL Operations';

interface SubmissionProps {
  onOpenModal: (id: ModalId, detail?: VarianceDetail) => void;
}

/** Does an edited cell breach the variance threshold vs its prior value? */
function isVariance(current: number, prior: number, settings: Settings): boolean {
  const minAbs = Number(String(settings.minValueToTrigger).replace(/[,\s]/g, '')) / 1000 || 0;
  if (Math.abs(current) < minAbs) return false;
  const pct = (Math.abs(current - prior) / Math.max(Math.abs(prior), 1)) * 100;
  return pct > settings.varianceThreshold;
}

export function Submission({ onOpenModal }: SubmissionProps) {
  const seed = seedFor(ENTITY);
  const settings = loadSettings(DEFAULT_SETTINGS);

  // Prior cycle values — deterministic from the entity seed, used for variance.
  const prior = useMemo<GridValues>(() => generateGridValues(seed, false).values, [seed]);

  // Load a persisted submission or seed a fresh one (with initial flags).
  const initial = useMemo<SubmissionModel>(() => {
    const stored = loadSubmission(CYCLE_ID, ENTITY);
    if (stored) return stored;
    const { values, flags } = generateGridValues(seed, true);
    const fresh: SubmissionModel = {
      cycleId: CYCLE_ID,
      entity: ENTITY,
      status: 'draft',
      values,
      flags,
      updatedAt: new Date().toISOString(),
    };
    saveSubmission(fresh);
    return fresh;
  }, [seed]);

  const [values, setValues] = useState<GridValues>(initial.values);
  const [flags, setFlags] = useState<Set<string>>(new Set(initial.flags));
  const [status, setStatus] = useState(initial.status);

  const persist = (nextValues: GridValues, nextFlags: Set<string>, nextStatus = status) => {
    saveSubmission({
      cycleId: CYCLE_ID,
      entity: ENTITY,
      status: nextStatus,
      values: nextValues,
      flags: [...nextFlags],
      updatedAt: new Date().toISOString(),
    });
  };

  const setCell = (rowIdx: number, dayIdx: number, value: number) => {
    const key = `${rowIdx}-${dayIdx}`;
    const nextValues = { ...values, [key]: value };
    const nextFlags = new Set(flags);
    if (isVariance(value, prior[key] || 0, settings)) nextFlags.add(key);
    else nextFlags.delete(key);
    setValues(nextValues);
    setFlags(nextFlags);
    persist(nextValues, nextFlags);
  };

  const handlePaste = (
    startRow: number,
    startDay: number,
    e: ClipboardEvent<HTMLInputElement>,
  ) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    const grid = text.trim().split(/\r?\n/).map((r) => r.split(/\t/));
    const nextValues = { ...values };
    const nextFlags = new Set(flags);
    grid.forEach((cols, ri) => {
      cols.forEach((raw, ci) => {
        const rowIdx = startRow + ri;
        const dayIdx = startDay + ci;
        if (rowIdx > 11 || dayIdx >= 30) return; // stay within editable data rows/days
        const key = `${rowIdx}-${dayIdx}`;
        const cleaned = raw.replace(/[€$,\s]/g, '');
        const n = Number(cleaned);
        if (!Number.isFinite(n)) return;
        nextValues[key] = n;
        if (isVariance(n, prior[key] || 0, settings)) nextFlags.add(key);
        else nextFlags.delete(key);
      });
    });
    setValues(nextValues);
    setFlags(nextFlags);
    persist(nextValues, nextFlags);
  };

  const reset = () => {
    if (!confirm('Reset all values?')) return;
    const { values: v, flags: f } = generateGridValues(seed, true);
    setValues(v);
    const nf = new Set(f);
    setFlags(nf);
    persist(v, nf);
  };

  const copyPrior = () => {
    const nf = new Set<string>();
    setValues(prior);
    setFlags(nf);
    persist(prior, nf);
    alert('Prior cycle values loaded. Edit as needed.');
  };

  const submit = () => {
    if (flags.size > 0) {
      if (confirm(`${flags.size} cells flagged for variance. Add commentary now?`)) {
        onOpenModal('variance');
        return;
      }
    }
    setStatus('submitted');
    persist(values, flags, 'submitted');
    alert('Forecast submitted for approval.');
  };

  return (
    <div className="view active">
      <TopBar
        crumb={`Submission · ${CYCLE_ID} · ${ENTITY}`}
        title="30-Day Forecast Entry"
        actions={
          <>
            <StatusPill status={status === 'draft' ? 'submitted' : status} label={status} />
            <button className="btn btn-ghost" onClick={() => persist(values, flags)}>
              Save Draft
            </button>
            <button
              className="btn btn-ghost btn-danger"
              onClick={() => alert('Submission cancelled.')}
            >
              Cancel
            </button>
            <button className="btn btn-primary" onClick={submit}>
              Submit for Approval
            </button>
          </>
        }
      />
      <div className="content">
        {flags.size > 0 && (
          <div className="variance-panel">
            <h4>⚠ Variance Flags Detected</h4>
            <div className="row">
              <span>
                Cells exceeding ±{settings.varianceThreshold}% vs prior cycle require commentary
                before submission.
              </span>
              <span>{flags.size} flagged</span>
            </div>
          </div>
        )}

        <div className="panel">
          <div className="grid-toolbar">
            <div className="grid-toolbar-left">
              <div className="grid-info">
                <strong>{ENTITY}</strong> ·{' '}
                <span className="text-muted">EUR · Daily values in thousands</span>
              </div>
              <span className="paste-hint">⌘V · Paste from Excel supported</span>
            </div>
            <div className="row-flex">
              <button className="btn btn-ghost" onClick={reset}>
                Reset
              </button>
              <button className="btn btn-ghost" onClick={copyPrior}>
                Copy Prior Forecast
              </button>
            </div>
          </div>
          <div className="forecast-grid-wrap">
            <ForecastGrid
              values={values}
              flags={flags}
              editable
              onChangeCell={setCell}
              onPaste={handlePaste}
              onCellClick={() => onOpenModal('variance')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
