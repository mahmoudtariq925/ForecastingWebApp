import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal } from '../common/Modal';
import { StatusPill } from '../common/StatusPill';
import { Chart, CHART_COLORS, type ChartSeries } from '../common/Chart';
import { ForecastGrid } from './ForecastGrid';
import { categoryGroups, dayNet, runningBalance } from './gridMath';
import { listEntities } from '../../data/appData';
import { templateDayLabels, weekLabel } from '../../data/periods';
import {
  activeCycleId,
  mergedEntityStatus,
  peekSubmission,
  templateForEntity,
} from '../../data/submissionService';
import { loadApprovals, loadTemplates } from '../../storage/localStorage';

interface ForecastPreviewProps {
  open: boolean;
  title: string;
  entity: string;
  week: string;
  onClose: () => void;
  /** Dialog actions — the caller decides (Submit, Approve, just Close…). */
  footer: ReactNode;
}

/**
 * A saved forecast presented in a dialog: the grid exactly as it stands (no
 * editing) with the chart underneath. Sections open COLLAPSED — whoever is
 * confirming a submission or an approval wants the shape first, and can open
 * any section they want to inspect.
 */
export function ForecastPreview({
  open,
  title,
  entity,
  week,
  onClose,
  footer,
}: ForecastPreviewProps) {
  const templates = useMemo(() => loadTemplates(), []);
  const template = useMemo(() => templateForEntity(templates, entity), [templates, entity]);
  // Re-peek whenever the dialog opens, so it always presents what is stored.
  const submission = useMemo(
    () => (open && template ? peekSubmission(entity, week, template) : null),
    [open, template, entity, week],
  );

  const sections = useMemo(
    () =>
      template
        ? categoryGroups(template.categories)
            .map((g, gi) => (g.label ? gi : -1))
            .filter((gi) => gi >= 0)
        : [],
    [template],
  );
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (open) setCollapsed(new Set(sections));
  }, [open, sections]);

  if (!template || !submission) return null;

  // The pill shows the entity's EFFECTIVE workflow state (decision map and
  // seed included) — the raw record says "draft" for a forecast that exists
  // only as demo data, which is not what a decision dialog should display.
  const entity_ = listEntities().find((e) => e.name === entity);
  const effectiveStatus = entity_
    ? mergedEntityStatus(entity_, week, template.id, loadApprovals(activeCycleId()))
    : submission.status;

  const dayLabels = templateDayLabels(template, week);
  const numCats = template.categories.length;
  const values = submission.values;
  const netByDay = dayLabels.map((_dl, d) => dayNet(numCats, values, d));
  const hasBalance = submission.startingBalance !== null;
  const series: ChartSeries[] = [
    { label: 'Net Cash Flow', values: netByDay, color: CHART_COLORS.blue, kind: 'bar' },
    ...(hasBalance
      ? [
          {
            label: 'Running Balance',
            values: dayLabels.map((_dl, d) =>
              runningBalance(numCats, values, submission.startingBalance ?? 0, d),
            ),
            color: CHART_COLORS.accent,
            kind: 'line' as const,
          },
        ]
      : []),
  ];

  return (
    <Modal open={open} title={title} onClose={onClose} footer={footer} size="xl">
      <div className="preview-meta">
        <strong>{entity}</strong>
        <span className="text-muted">{weekLabel(week)}</span>
        <span className="text-muted">{template.name}</span>
        <StatusPill status={effectiveStatus} />
        <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
          Sections open collapsed — click ▸ to see the line items
        </span>
      </div>
      <div className="forecast-grid-wrap preview-grid">
        <ForecastGrid
          categories={template.categories}
          layout={template.layout}
          dayLabels={dayLabels}
          values={values}
          flags={new Set(submission.flags)}
          collapsedGroups={collapsed}
          onToggleGroup={(gi) =>
            setCollapsed((prev) => {
              const next = new Set(prev);
              if (next.has(gi)) next.delete(gi);
              else next.add(gi);
              return next;
            })
          }
          startingBalance={submission.startingBalance}
          editable={false}
          showColumnTotals={template.columnTotals === true}
        />
      </div>
      <Chart labels={dayLabels.map((dl) => dl.dm)} series={series} unit="k" height={170} />
    </Modal>
  );
}
