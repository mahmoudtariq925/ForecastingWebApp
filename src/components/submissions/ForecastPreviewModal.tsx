import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal } from '../common/Modal';
import { StatusPill } from '../common/StatusPill';
import { Chart, CHART_COLORS, type ChartSeries } from '../common/Chart';
import { ForecastGrid } from './ForecastGrid';
import { RequestCommentaryModal } from './RequestCommentaryModal';
import { categoryGroups, cellKey, dayNet, runningBalance } from './gridMath';
import { useDataVersion } from '../../data/useDataVersion';
import {
  getPriorValues,
  peekSubmission,
  priorValueFor,
  requesterLabel,
  templateForEntity,
} from '../../data/submissionService';
import { templateDayLabels, weekLabel, weekLabelShort } from '../../data/periods';
import { loadTemplates } from '../../storage/localStorage';

interface ForecastPreviewModalProps {
  open: boolean;
  entity: string;
  week: string;
  title: string;
  onClose: () => void;
  /** Extra footer buttons (Submit / Approve) rendered after Close. */
  actions?: ReactNode;
  /**
   * Treasury and approvers: every cell can be asked about from here, without
   * leaving for the full forecast page.
   */
  canRequestComments?: boolean;
  /** A cell (`${catIdx}-${dayIdx}`) to open the question dialog on arrival. */
  focusCell?: string;
}

/**
 * A saved forecast presented read-only inside a dialog: the grid exactly as
 * last saved, with the running-balance chart underneath. Sections open
 * COLLAPSED — whoever opens this is judging the shape of a forecast, not
 * re-reading twelve line items — and can be expanded from the grid itself.
 *
 * With `canRequestComments`, it is also where a question gets asked: the
 * reviewer reading the forecast is exactly the person who has one, and sending
 * them to the full page to ask it lost the list they were working through.
 *
 * Used by the checklist's "Submit Forecast" preview, the approver's approve
 * confirmation and treasury's dashboard modals. Mount it fresh per entity
 * (conditional render) so the collapsed state resets between forecasts.
 */
export function ForecastPreviewModal({
  open,
  entity,
  week,
  title,
  onClose,
  actions,
  canRequestComments = false,
  focusCell,
}: ForecastPreviewModalProps) {
  // A question rewrites the stored submission (it flags the cell and can send
  // the forecast back to its submitter), so the grid behind the dialog has to
  // re-read rather than keep showing the forecast as it was on open.
  const dataVersion = useDataVersion();
  const template = useMemo(() => templateForEntity(loadTemplates(), entity), [entity]);
  const submission = useMemo(
    () => {
      void dataVersion;
      return template ? peekSubmission(entity, week, template) : null;
    },
    [entity, week, template, dataVersion],
  );
  const dayLabels = useMemo(() => templateDayLabels(template, week), [template, week]);
  const prior = useMemo(
    () => (template ? getPriorValues(entity, week, template) : {}),
    [entity, week, template],
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
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set(sections));
  const toggleGroup = (gi: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(gi)) next.delete(gi);
      else next.add(gi);
      return next;
    });

  /** The cell whose question dialog is open, if any. */
  const [asking, setAsking] = useState<string | null>(null);
  // Arriving from "this country owes commentary on THIS cell": open on it.
  useEffect(() => {
    if (open && canRequestComments && focusCell) setAsking(focusCell);
  }, [open, canRequestComments, focusCell]);

  const askCell = (catIdx: number, dayIdx: number) => {
    // Expand the section first, so closing the dialog leaves the cell in view.
    const gi = template
      ? categoryGroups(template.categories).findIndex((g) => g.idxs.includes(catIdx))
      : -1;
    if (gi >= 0) setCollapsed((prev) => (prev.has(gi) ? new Set([...prev].filter((g) => g !== gi)) : prev));
    setAsking(cellKey(catIdx, dayIdx));
  };

  const numCats = template?.categories.length ?? 0;
  const values = submission?.values ?? {};
  const requests = submission?.commentRequests ?? {};
  const openRequests = Object.entries(requests);
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

  /** The cell being asked about, as the shared question dialog wants it. */
  const askTarget = (() => {
    if (!asking || !template || !submission) return null;
    const [c, d] = asking.split('-').map(Number);
    if (!Number.isFinite(c) || !Number.isFinite(d)) return null;
    return {
      entity,
      week,
      templateId: template.id,
      cellKey: asking,
      label: template.categories[c]?.label ?? `Line ${c + 1}`,
      periodLabel: dayLabels[d] ? `${dayLabels[d].dow} ${dayLabels[d].dm}` : `Day ${d + 1}`,
      current: values[asking] ?? 0,
      prior: priorValueFor(prior, c, d, template),
      comment: submission.comments?.[asking] ?? '',
    };
  })();

  return (
    <>
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
                {template.name} · {weekLabel(week)} · EUR thousands
              </span>
              {canRequestComments && (
                <span className="text-muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
                  Click any cell to ask its submitter about it
                </span>
              )}
            </div>
            {/* Questions already waiting on this forecast, so the same one is
                not asked twice from two different screens. */}
            {openRequests.length > 0 && (
              <div className="comment-request-note">
                <strong>
                  {openRequests.length} open question{openRequests.length === 1 ? '' : 's'}:
                </strong>{' '}
                {openRequests
                  .map(([key, r]) => {
                    const [c, d] = key.split('-').map(Number);
                    const where = dayLabels[d] ? dayLabels[d].dm : `Day ${d + 1}`;
                    return `${template.categories[c]?.label ?? `Line ${c + 1}`} · ${where} (${r.from}, ${requesterLabel(r.fromRole)})`;
                  })
                  .join(' · ')}
              </div>
            )}
            <div className="forecast-grid-wrap preview-grid">
              <ForecastGrid
                categories={template.categories}
                layout={template.layout}
                dayLabels={dayLabels}
                values={values}
                flags={new Set(submission.flags)}
                requested={new Set(Object.keys(requests))}
                startingBalance={submission.startingBalance}
                editable={false}
                onCellClick={canRequestComments ? askCell : undefined}
                clickableCells="all"
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
      {/* Over the forecast rather than instead of it: the question is about a
          number that stays on screen behind the dialog. */}
      {askTarget && (
        <RequestCommentaryModal
          target={askTarget}
          context={`${entity} · ${weekLabelShort(week)}`}
          existing={requests[askTarget.cellKey] ?? null}
          flagged={submission?.flags.includes(askTarget.cellKey) ?? false}
          onClose={() => setAsking(null)}
        />
      )}
    </>
  );
}
