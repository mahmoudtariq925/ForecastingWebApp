import { useState } from 'react';
import { Modal } from './Modal';
import {
  buildStandardTemplate,
  cycles as seedCycles,
  entities,
  generateGridValues,
  seedFor,
} from '../../data/mockData';
import { DEFAULT_PERIOD, dayLabelsForPeriod } from '../../data/periods';
import { listSubmissions, loadCycles } from '../../storage/localStorage';
import {
  cyclesTable,
  exportGridXlsx,
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

/** Shared dialogs: New Cycle (creates + persists) and Export (real downloads). */
export function AppModals({ modal, onClose, onCreateCycle }: AppModalsProps) {
  const [cycleId, setCycleId] = useState('CW-2026-22');
  const [startDate, setStartDate] = useState('2026-05-25');
  const [deadline, setDeadline] = useState('2026-05-29T18:00');
  const [format, setFormat] = useState<'xlsx' | 'csv' | 'json'>('xlsx');
  const [scope, setScope] = useState('consolidated');
  const [busy, setBusy] = useState(false);

  const createCycle = () => {
    const id = cycleId.trim();
    if (!id) {
      alert('Please enter a cycle ID.');
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
        const tpl = buildStandardTemplate();
        const values = generateGridValues(
          tpl.rows,
          DEFAULT_PERIOD,
          seedFor(`Consolidated:${DEFAULT_PERIOD}`),
          false,
        ).values;
        if (format === 'xlsx') {
          await exportGridXlsx(
            tpl.rows,
            dayLabelsForPeriod(DEFAULT_PERIOD),
            values,
            'consolidated-forecast.xlsx',
            'Consolidated',
          );
        } else {
          // Tabular fallback for csv/json: one row per line item.
          const dayLabels = dayLabelsForPeriod(DEFAULT_PERIOD);
          const table = {
            name: 'Consolidated',
            header: ['Category', ...dayLabels.map((_d, i) => `D${i + 1}`)],
            rows: tpl.rows
              .filter((r) => r.kind === 'data')
              .map((r) => {
                const rowIdx = tpl.rows.indexOf(r);
                return [
                  r.label,
                  ...dayLabels.map((_d, i) => values[`${rowIdx}-${i}`] || 0),
                ];
              }),
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
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
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
