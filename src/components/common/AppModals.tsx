import { useState } from 'react';
import { Modal } from './Modal';
import { useDialog } from './dialogContext';
import {
  cycles as seedCycles,
  entities,
  STANDARD_TEMPLATE_ID,
} from '../../data/mockData';
import {
  currentWeekKey,
  dayLabelsForWeek,
  horizonDates,
  shiftWeeks,
  weekLabelShort,
} from '../../data/periods';
import { consolidatedValues } from '../../data/submissionService';
import { listSubmissions, loadCycles, loadTemplates } from '../../storage/localStorage';
import {
  cyclesTable,
  exportSubmissionXlsx,
  exportTable,
  submissionsTable,
} from '../../utils/excel';
import type { Cycle } from '../../types';
import type { ModalId } from '../../types/nav';

interface AppModalsProps {
  modal: ModalId;
  onClose: () => void;
  /** Called with the fully-formed cycle when the user confirms creation. */
  onCreateCycle: (cycle: Cycle) => void;
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
}

function fmtDeadline(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} · ${time}`;
}

/** Sensible defaults for a new cycle: next id after the latest stored one,
 * starting next Monday, closing that week's Friday 18:00. */
function nextCycleDefaults(): { id: string; start: string; deadline: string } {
  const cycles = loadCycles(seedCycles);
  let id = 'CW-2026-22';
  const parsed = cycles
    .map((c) => /^CW-(\d{4})-(\d+)$/.exec(c.id))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => Number(b[1]) - Number(a[1]) || Number(b[2]) - Number(a[2]))[0];
  if (parsed) id = `CW-${parsed[1]}-${String(Number(parsed[2]) + 1).padStart(2, '0')}`;
  const start = shiftWeeks(currentWeekKey(), 1);
  const [y, m, d] = start.split('-').map(Number);
  const friday = new Date(y, m - 1, d + 4);
  const iso = `${friday.getFullYear()}-${String(friday.getMonth() + 1).padStart(2, '0')}-${String(
    friday.getDate(),
  ).padStart(2, '0')}`;
  return { id, start, deadline: `${iso}T18:00` };
}

/** Shared dialogs: New Cycle (creates + persists) and Export (real downloads). */
export function AppModals({ modal, onClose, onCreateCycle }: AppModalsProps) {
  const defaults = useState(nextCycleDefaults)[0];
  const [cycleId, setCycleId] = useState(defaults.id);
  const [startDate, setStartDate] = useState(defaults.start);
  const [deadline, setDeadline] = useState(defaults.deadline);
  const [format, setFormat] = useState<'xlsx' | 'csv' | 'json'>('xlsx');
  const [scope, setScope] = useState('consolidated');
  const [busy, setBusy] = useState(false);
  const { notify } = useDialog();

  const createCycle = async () => {
    const id = cycleId.trim();
    if (!id) {
      await notify({ tone: 'error', message: 'Please enter a cycle ID.' });
      return;
    }
    onCreateCycle({
      id,
      start: fmtDay(startDate),
      closes: fmtDeadline(deadline),
      status: 'submitted',
      subs: `0 / ${entities.length}`,
      total: 0,
    });
  };

  const runExport = async () => {
    setBusy(true);
    try {
      if (scope === 'consolidated') {
        const templates = loadTemplates();
        const tpl = templates.find((t) => t.id === STANDARD_TEMPLATE_ID) ?? templates[0];
        if (!tpl) throw new Error('No forecast template available.');
        const week = currentWeekKey();
        // Same live consolidation the Dashboard / Consolidated screens show.
        const { values, startingBalance } = consolidatedValues(week, tpl);
        const dayLabels = dayLabelsForWeek(week);
        if (format === 'xlsx') {
          await exportSubmissionXlsx({
            template: tpl,
            layout: 'days-across',
            entity: 'Consolidated (all entities)',
            weekLabel: weekLabelShort(week),
            dates: horizonDates(week),
            dayLabels,
            values,
            startingBalance,
            filename: 'consolidated-forecast.xlsx',
          });
        } else {
          // Tabular fallback for csv/json: one row per line item.
          const table = {
            name: 'Consolidated',
            header: ['Category', ...dayLabels.map((_d, i) => `D${i + 1}`)],
            rows: tpl.categories.map((cat, catIdx) => [
              cat.label,
              ...dayLabels.map((_d, i) => values[`${catIdx}-${i}`] || 0),
            ]),
          };
          await exportTable(table, format, 'consolidated-forecast');
        }
      } else if (scope === 'submissions') {
        await exportTable(submissionsTable(listSubmissions()), format, 'submissions');
      } else if (scope === 'cycles4') {
        await exportTable(cyclesTable(loadCycles(seedCycles).slice(0, 4)), format, 'last-4-cycles');
      } else {
        await exportTable(cyclesTable(loadCycles(seedCycles)), format, 'cycles-ytd');
      }
      onClose();
    } catch (err) {
      await notify({
        title: 'Export failed',
        tone: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={modal === 'newCycle'}
        title="Open New Forecast Cycle"
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={createCycle}>
              Open Cycle
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">Cycle ID</label>
          <input
            className="form-input"
            value={cycleId}
            onChange={(e) => setCycleId(e.target.value)}
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Start Date</label>
            <input
              className="form-input"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Submission Deadline</label>
            <input
              className="form-input"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Notify</label>
          <select
            className="form-select"
            multiple
            style={{ height: 80 }}
            defaultValue={['All submitters', 'All approvers']}
          >
            <option>All submitters</option>
            <option>All approvers</option>
            <option>Treasury team only</option>
          </select>
        </div>
      </Modal>

      <Modal
        open={modal === 'export'}
        title="Export Data"
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={runExport} disabled={busy}>
              {busy ? 'Exporting…' : 'Export'}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">Format</label>
          <select
            className="form-select"
            value={format}
            onChange={(e) => setFormat(e.target.value as 'xlsx' | 'csv' | 'json')}
          >
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Scope</label>
          <select
            className="form-select"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="consolidated">Current cycle — consolidated</option>
            <option value="submissions">Current cycle — all submissions</option>
            <option value="cycles4">Last 4 cycles</option>
            <option value="ytd">Year-to-date</option>
          </select>
        </div>
      </Modal>
    </>
  );
}
