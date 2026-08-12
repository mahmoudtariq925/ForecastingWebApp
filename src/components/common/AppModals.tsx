import { useState } from 'react';
import { Modal } from './Modal';
import { useDialog } from './dialogContext';
import { STANDARD_TEMPLATE_ID } from '../../data/mockData';
import { listEntities } from '../../data/appData';
import { activeWeekKey, cycleIdFor, listCycles } from '../../data/cycleService';
import {
  cadenceWeeks,
  dayLabelsForWeek,
  horizonDates,
  shiftWeeks,
  weekLabel,
  weekLabelShort,
} from '../../data/periods';
import { consolidatedValues } from '../../data/submissionService';
import { cycleOverview } from '../../data/dashboardService';
import { listSubmissions, loadTemplates } from '../../storage/localStorage';
import {
  cyclesTable,
  exportSubmissionXlsx,
  exportTable,
  submissionsTable,
} from '../../utils/excel';
import type { ModalId } from '../../types/nav';

interface AppModalsProps {
  modal: ModalId;
  onClose: () => void;
  /** Called with the forecast week to open a cycle for. */
  onCreateCycle: (weekKey: string) => void;
}

/** Friday 18:00 of a forecast week — the submission deadline. */
function deadlineLabel(weekKey: string): string {
  const [y, m, d] = weekKey.split('-').map(Number);
  const friday = new Date(y, m - 1, d + 4);
  return `${friday.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} · 18:00`;
}

/**
 * Forecast weeks a cycle can still be opened for: the next eight weeks that do
 * not already have one.
 *
 * A cycle IS a week, so it is chosen rather than typed. The old form asked for
 * a free-text cycle id, which could be left blank (the dialog then silently
 * refused to close) or set to anything at all, which is how "CW-2026-21" came
 * to sit above data for a completely different week.
 */
function openableWeeks(): string[] {
  const taken = new Set(listCycles().map((c) => c.weekKey));
  const from = activeWeekKey();
  const step = cadenceWeeks();
  const out: string[] = [];
  for (let i = 1; out.length < 8 && i <= 24; i++) {
    const week = shiftWeeks(from, i * step);
    if (!taken.has(week)) out.push(week);
  }
  return out;
}

/** Shared dialogs: New Cycle (creates + persists) and Export (real downloads). */
export function AppModals({ modal, onClose, onCreateCycle }: AppModalsProps) {
  const weeks = useState(openableWeeks)[0];
  const [week, setWeek] = useState(weeks[0] ?? '');
  const [format, setFormat] = useState<'xlsx' | 'csv' | 'json'>('xlsx');
  const [scope, setScope] = useState('consolidated');
  const [busy, setBusy] = useState(false);
  const { notify } = useDialog();

  const createCycle = async () => {
    if (!week) {
      await notify({ tone: 'error', message: 'Please choose a forecast week to open.' });
      return;
    }
    onCreateCycle(week);
  };

  const runExport = async () => {
    setBusy(true);
    try {
      if (scope === 'consolidated') {
        const templates = loadTemplates();
        const tpl = templates.find((t) => t.id === STANDARD_TEMPLATE_ID) ?? templates[0];
        if (!tpl) throw new Error('No forecast template available.');
        const week = activeWeekKey();
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
        await exportTable(cyclesTable(listCycles().slice(0, 4), cycleOverview), format, 'last-4-cycles');
      } else {
        await exportTable(cyclesTable(listCycles(), cycleOverview), format, 'cycles-ytd');
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
          <label className="form-label">Forecast Week</label>
          <select
            className="form-select"
            value={week}
            onChange={(e) => setWeek(e.target.value)}
          >
            {weeks.map((w) => (
              <option key={w} value={w}>
                {weekLabel(w)}
              </option>
            ))}
          </select>
          <p className="form-hint">
            {week
              ? `Opens as ${cycleIdFor(week)}, closing ${deadlineLabel(week)}, for ${listEntities().length} entities.`
              : 'Every upcoming week already has a cycle.'}
          </p>
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
