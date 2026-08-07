import { useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Chart, CHART_COLORS, type ChartSeries } from '../common/Chart';
import { useDialog } from '../common/dialogContext';
import { consolidatedReport } from '../../data/dashboardService';
import { consolidatedValues } from '../../data/submissionService';
import { listEntities, seedUsers } from '../../data/appData';
import { currentUser } from '../../data/session';
import {
  prevWeekKey,
  templateDates,
  templateDayLabels,
  weekLabel,
  weekLabelShort,
} from '../../data/periods';
import { loadUsers } from '../../storage/localStorage';
import { exportSubmissionXlsx } from '../../utils/excel';
import { appUrl, openEmail } from '../../utils/email';
import type { ForecastTemplate } from '../../types';

interface ConsolidatedModalProps {
  open: boolean;
  week: string;
  template: ForecastTemplate;
  onClose: () => void;
}

const fmtM = (v: number) => `€ ${(v / 1000).toFixed(1)}M`;

/**
 * The consolidated group forecast, as a modal off the outlook chart — the old
 * Consolidated screen's job without a page of its own.
 *
 * Every line expands into the countries that add up to it, so "why is the
 * group number what it is" is answered in the same place the number is read,
 * rather than by cross-referencing a second screen.
 */
export function ConsolidatedModal({ open, week, template, onClose }: ConsolidatedModalProps) {
  const { notify } = useDialog();
  const report = useMemo(
    () => consolidatedReport(week, prevWeekKey(week), template),
    [week, template],
  );
  const dayLabels = useMemo(() => templateDayLabels(template, week), [template, week]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (label: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const series: ChartSeries[] = [
    { label: 'Inflows', values: report.series.inflows, color: CHART_COLORS.green, kind: 'bar' },
    { label: 'Outflows', values: report.series.outflows, color: CHART_COLORS.red, kind: 'bar' },
    { label: 'Net Cash Flow', values: report.series.net, color: CHART_COLORS.accent, kind: 'line' },
  ];

  const exportXlsx = () => {
    const current = consolidatedValues(week, template);
    exportSubmissionXlsx({
      template,
      layout: 'days-across',
      entity: 'Consolidated (all entities)',
      weekLabel: weekLabelShort(week),
      dates: templateDates(template, week),
      dayLabels,
      values: current.values,
      startingBalance: current.startingBalance,
      filename: `consolidated-${week}.xlsx`,
    }).catch((err) =>
      notify({
        title: 'Export failed',
        tone: 'error',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  };

  const emailSummary = () => {
    const me = currentUser();
    const recipients = loadUsers(seedUsers())
      .filter((u) => u.role === 'treasury' && u.email !== me.email)
      .map((u) => u.email);
    const line = (label: string) => report.lines.find((l) => l.label === label)?.total ?? 0;
    openEmail({
      to: recipients,
      subject: `Consolidated cash flow forecast — ${weekLabel(week)}`,
      body:
        `Hi team,\n\n` +
        `Consolidated forecast across ${listEntities().length} entities for ${weekLabel(week)}:\n\n` +
        `Total inflows: ${fmtM(line('Total inflows'))}\n` +
        `Total outflows: ${fmtM(Math.abs(line('Total outflows')))}\n` +
        `Net cash flow: ${fmtM(line('Net cash flow'))}\n\n` +
        `Full detail: ${appUrl()}\n\n` +
        `Best regards,\n${me.name}\n${me.email}`,
    });
  };

  return (
    <Modal
      open={open}
      title={`Consolidated Forecast · ${weekLabelShort(week)}`}
      size="xl"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={exportXlsx}>
            Export XLSX
          </button>
          <button className="btn btn-ghost" onClick={emailSummary}>
            Email Summary
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="preview-meta">
        <span className="text-dim">
          {report.entityCount} entities · {template.name} · EUR thousands
        </span>
        <span className="progress-summary">Click a line for its country breakdown</span>
      </div>

      {report.omitted.length > 0 && (
        <div className="grid-note" role="note" style={{ borderRadius: 6, marginBottom: 12 }}>
          <strong>
            {report.omitted.length} line item{report.omitted.length === 1 ? '' : 's'} not
            consolidated.
          </strong>{' '}
          These entities forecast on a template whose rows have no counterpart in {template.name}:{' '}
          {report.omitted.map((o) => `${o.label} (${o.entities.join(', ')})`).join(' · ')}.
        </div>
      )}

      <div className="panel-body no-pad">
        <table className="breakdown-table">
          <thead>
            <tr>
              <th>Line item</th>
              <th className="num">Prior (€k)</th>
              <th className="num">Current (€k)</th>
              <th className="num">Δ %</th>
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => {
              const isOpen = expanded.has(line.label);
              return (
                <BreakdownRows
                  key={line.label}
                  line={line}
                  isOpen={isOpen}
                  onToggle={() => toggle(line.label)}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="preview-chart">
        <Chart
          labels={dayLabels.map((dl) => dl.dm)}
          series={series}
          unit="k"
          height={180}
          stacked
        />
      </div>
    </Modal>
  );
}

/** One consolidated line, plus its country rows while expanded. */
function BreakdownRows({
  line,
  isOpen,
  onToggle,
}: {
  line: ReturnType<typeof consolidatedReport>['lines'][number];
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className={`breakdown-row${line.emphasis ? ' emphasis' : ''}`}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <td>
          <span className="section-caret" aria-hidden="true">
            {isOpen ? '▾' : '▸'}
          </span>
          <strong>{line.label}</strong>
          <span className="text-muted breakdown-count">
            {line.countries.length} countr{line.countries.length === 1 ? 'y' : 'ies'}
          </span>
        </td>
        <td className="num">{Math.round(line.prior).toLocaleString()}</td>
        <td className="num">{Math.round(line.total).toLocaleString()}</td>
        <td className="num">
          {line.pct === null ? (
            <span className="text-muted">—</span>
          ) : (
            <span className={`delta ${line.pct > 0 ? 'up' : 'down'}`}>
              {line.pct > 0 ? '+' : ''}
              {line.pct.toFixed(1)}%
            </span>
          )}
        </td>
      </tr>
      {isOpen &&
        (line.countries.length === 0 ? (
          <tr className="breakdown-child">
            <td colSpan={4} className="text-muted">
              No entity contributes to this line.
            </td>
          </tr>
        ) : (
          line.countries.map((c) => (
            <tr className="breakdown-child" key={c.entity}>
              <td>{c.entity}</td>
              <td className="num text-muted">—</td>
              <td className="num">{Math.round(c.value).toLocaleString()}</td>
              <td className="num text-muted">
                {line.total === 0 ? '—' : `${Math.round((c.value / line.total) * 100)}%`}
              </td>
            </tr>
          ))
        ))}
    </>
  );
}
