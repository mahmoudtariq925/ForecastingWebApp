import { useMemo, useState, type ReactNode } from 'react';
import { Modal } from '../common/Modal';
import { StatusPill } from '../common/StatusPill';
import { Chart, CHART_COLORS, type ChartSeries } from '../common/Chart';
import { ForecastGrid } from './ForecastGrid';
import { categoryGroups, dayNet, runningBalance } from './gridMath';
import { peekSubmission, templateForEntity } from '../../data/submissionService';
import { templateDayLabels, weekLabel } from '../../data/periods';
import { loadTemplates } from '../../storage/localStorage';

interface ForecastPreviewModalProps {
  open: boolean;
  entity: string;
  week: string;
  title: string;
  onClose: () => void;
  /** Extra footer buttons (Submit / Approve) rendered after Close. */
  actions?: ReactNode;
}

/**
 * A saved forecast presented read-only inside a dialog: the grid exactly as
 * last saved, with the running-balance chart underneath. Sections open
 * COLLAPSED — whoever opens this is judging the shape of a forecast, not
 * re-reading twelve line items — and can be expanded from the grid itself.
 *
 * Used by the checklist's "Submit Forecast" preview and by the approver's
 * approve confirmation. Mount it fresh per entity (conditional render) so the
 * collapsed state resets between forecasts.
 */
export function ForecastPreviewModal({
  open,
  entity,
  week,
  title,
  onClose,
  actions,
}: ForecastPreviewModalProps) {
  const template = useMemo(() => templateForEntity(loadTemplates(), entity), [entity]);
  const submission = useMemo(
    () => (template ? peekSubmission(entity, week, template) : null),
    [entity, week, template],
  );
  const dayLabels = useMemo(() => templateDayLabels(template, week), [template, week]);

  const sections = useMemo(
    () =>
      template
        ? categoryGroups(template.categories)
            .map((g, gi) => (g.label ? gi : -1))
            .filter((gi) => gi >= 0)
        : [],
    [template],
  );
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set(sections));
  const toggleGroup = (gi: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(gi)) next.delete(gi);
      else next.add(gi);
      return next;
    });

  const numCats = template?.categories.length ?? 0;
  const values = submission?.values ?? {};
  const hasBalance = submission?.startingBalance != null;
  const netByDay = dayLabels.map((_dl, d) => dayNet(numCats, values, d));
  const series: ChartSeries[] = [
    { label: 'Net Cash Flow', values: netByDay, color: CHART_COLORS.blue, kind: 'bar' },
    ...(hasBalance
      ? [
          {
            label: 'Running Balance',
            values: dayLabels.map((_dl, d) =>
              runningBalance(numCats, values, submission?.startingBalance ?? 0, d),
            ),
            color: CHART_COLORS.accent,
            kind: 'line' as const,
          },
        ]
      : []),
  ];

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          {actions}
        </>
      }
    >
      {!template || !submission ? (
        <div className="empty-state">
          <div className="ic">▦</div>
          <p>No forecast template is configured for {entity} yet.</p>
        </div>
      ) : (
        <>
          <div className="preview-meta">
            <StatusPill status={submission.status} />
            <span className="text-dim">
              {template.name} · {weekLabel(week)} · EUR thousands · sections collapsed — click a
              caret to expand
            </span>
          </div>
          <div className="forecast-grid-wrap preview-grid">
            <ForecastGrid
              categories={template.categories}
              layout={template.layout}
              dayLabels={dayLabels}
              values={values}
              flags={new Set(submission.flags)}
              startingBalance={submission.startingBalance}
              editable={false}
              collapsedGroups={collapsed}
              onToggleGroup={toggleGroup}
              showColumnTotals={template.columnTotals === true}
            />
          </div>
          <div className="preview-chart">
            <Chart labels={dayLabels.map((dl) => dl.dm)} series={series} unit="k" height={170} />
          </div>
        </>
      )}
    </Modal>
  );
}
