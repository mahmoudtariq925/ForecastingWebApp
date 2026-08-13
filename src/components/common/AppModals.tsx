import { useState } from 'react';
import { Modal } from './Modal';
import { useDialog } from './dialogContext';
import { STANDARD_TEMPLATE_ID } from '../../data/mockData';
import { activeWeekKey, listCycles } from '../../data/cycleService';
import { dayLabelsForWeek, horizonDates, weekLabelShort } from '../../data/periods';
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
}

/** Shared dialogs — currently just Export, which produces real downloads. */
export function AppModals({ modal, onClose }: AppModalsProps) {
  const [format, setFormat] = useState<'xlsx' | 'csv' | 'json'>('xlsx');
  const [scope, setScope] = useState('consolidated');
  const [busy, setBusy] = useState(false);
  const { notify } = useDialog();

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
