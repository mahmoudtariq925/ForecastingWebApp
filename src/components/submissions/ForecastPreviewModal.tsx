import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal } from '../common/Modal';
import { StatusPill } from '../common/StatusPill';
import { Chart, CHART_COLORS, OVERLAY_COLORS, type ChartSeries } from '../common/Chart';
import { ForecastGrid } from './ForecastGrid';
import { customRowsOf, gridCategories } from '../../data/customRows';
import { RequestCommentaryModal } from './RequestCommentaryModal';
import { categoryGroups, cellKey, dayNet, runningBalance } from './gridMath';
import { useDataVersion } from '../../data/useDataVersion';
import {
  getPriorValues,
  isOpenQuestion,
  openQuestionEntries,
  peekSubmission,
  priorValueFor,
  requesterLabel,
  templateForEntity,
} from '../../data/submissionService';
import { listCycles } from '../../data/cycleService';
import { rollShift, templateDayLabels, weekLabel, weekLabelShort } from '../../data/periods';
import { loadTemplates } from '../../storage/localStorage';

/** How many prior cycles can be overlaid — beyond four there is no overlap. */
const COMPARE_DEPTH = 4;

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

  /** Earlier cycles this forecast can be read against. */
  const compareOptions = useMemo(() => {
    void dataVersion;
    return listCycles()
      .filter((c) => c.weekKey < week)
      .slice(0, COMPARE_DEPTH)
      .map((c) => ({ week: c.weekKey, label: weekLabelShort(c.weekKey) }));
  }, [week, dataVersion]);
  const [compareWeeks, setCompareWeeks] = useState<string[]>([]);
  const toggleCompare = (key: string) =>
    setCompareWeeks((prev) =>
      prev.includes(key) ? prev.filter((w) => w !== key) : [...prev, key],
    );

  // The forecast's own lines, the submitter's added rows included — read the
  // template alone and a preview would show a different total from the grid
  // it is previewing.
  const gridCats = useMemo(
    () => (template ? gridCategories(template, customRowsOf(submission)) : []),
    [template, submission],
  );
  const sections = useMemo(
    () =>
      categoryGroups(gridCats)
        .map((g, gi) => (g.label ? gi : -1))
        .filter((gi) => gi >= 0),
    [gridCats],
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
    const gi = categoryGroups(gridCats).findIndex((g) => g.idxs.includes(catIdx));
    if (gi >= 0) setCollapsed((prev) => (prev.has(gi) ? new Set([...prev].filter((g) => g !== gi)) : prev));
    setAsking(cellKey(catIdx, dayIdx));
  };

  const numCats = gridCats.length;
  const values = submission?.values ?? {};
  const requests = submission?.commentRequests ?? {};
  /** Questions still waiting on the submitter — an answered one is history. */
  const openRequests = openQuestionEntries(requests);
  /** Cells whose question has come back, so the answer can be read first. */
  const answered = Object.entries(requests).filter(([key, r]) => r.answeredAt && submission?.comments?.[key]?.trim());
  const hasBalance = submission?.startingBalance != null;
  const netByDay = dayLabels.map((_dl, d) => dayNet(numCats, values, d));
  // While earlier cycles are laid over it, this week's net is drawn in the
  // same mark they are — dashed lines against a bar chart are not a
  // comparison the eye can make. Alone, it is the week's columns again.
  const comparing = compareWeeks.length > 0;
  const series: ChartSeries[] = [
    {
      label: comparing ? `${weekLabelShort(week)} · Net Cash Flow` : 'Net Cash Flow',
      values: netByDay,
      color: CHART_COLORS.blue,
      kind: comparing ? 'line' : 'bar',
    },
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

  /** "Receivables · Mon 10/8" for a cell key. */
  const cellName = (key: string): string => {
    const [c, d] = key.split('-').map(Number);
    const line = template?.categories[c]?.label ?? `Line ${c + 1}`;
    return `${line} · ${dayLabels[d] ? `${dayLabels[d].dow} ${dayLabels[d].dm}` : `Day ${d + 1}`}`;
  };

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
      label: gridCats[c]?.label ?? `Line ${c + 1}`,
      periodLabel: dayLabels[d] ? `${dayLabels[d].dow} ${dayLabels[d].dm}` : `Day ${d + 1}`,
      current: values[asking] ?? 0,
      prior: priorValueFor(prior, c, d, template),
      comment: submission.comments?.[asking] ?? '',
    };
  })();

  /**
   * The same entity's earlier forecasts, aligned on the calendar days they
   * share with this one. Horizons roll forward a cycle at a time, so a
   * forecast N cycles back covers this week's day d at its own day d + N·roll;
   * past that its horizon ran out, which is a gap rather than a zero.
   */
  const overlaySeries: ChartSeries[] = useMemo(() => {
    void dataVersion;
    if (!template) return [];
    const step = rollShift(template);
    return compareWeeks.map((key, i) => {
      const past = peekSubmission(entity, key, template);
      const back = compareOptions.findIndex((o) => o.week === key) + 1;
      return {
        label: `${weekLabelShort(key)} · Net Cash Flow`,
        values: dayLabels.map((_dl, d) => {
          const from = d + back * step;
          return from >= dayLabels.length ? null : dayNet(numCats, past.values, from);
        }),
        color: OVERLAY_COLORS[i % OVERLAY_COLORS.length],
        kind: 'line' as const,
        dashed: true,
      };
    });
  }, [compareWeeks, compareOptions, template, entity, dayLabels, numCats, dataVersion]);

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
                <span className="text-muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
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
                  .map(([key, r]) => `${cellName(key)} (${r.from}, ${requesterLabel(r.fromRole)})`)
                  .join(' · ')}
              </div>
            )}
            {/* Answers that have come back. Whoever asked opens this dialog to
                read the reply, and hunting for a blue cell to click was the
                only way to find it. */}
            {answered.map(([key, r]) => (
              <div className="comment-request-note answered-note" key={key}>
                <strong>{cellName(key)}</strong> · asked by {r.from} (
                {requesterLabel(r.fromRole)}): {r.message}
                <div className="answered-reply">
                  <strong>Answer:</strong> {submission.comments?.[key]}
                </div>
              </div>
            ))}
            <div className="forecast-grid-wrap preview-grid">
              <ForecastGrid
                // Same forecast, same weeks — this dialog is a reading of the
                // submission screen's grid, not of the template behind it.
                weekBands
                categories={gridCats}
                layout={template.layout}
                dayLabels={dayLabels}
                values={values}
                flags={new Set(submission.flags)}
                requested={new Set(openRequests.map(([key]) => key))}
                startingBalance={submission.startingBalance}
                editable={false}
                onCellClick={canRequestComments ? askCell : undefined}
                clickableCells="all"
                collapsedGroups={collapsed}
                onToggleGroup={toggleGroup}
                showColumnTotals={template.columnTotals === true}
              />
            </div>
            {/* The shape of the week, under the numbers that make it. Taller
                and narrower than the grid above it: a trend is read off the
                height of the line, and a chart the full width of an xl dialog
                flattened four weeks into a straight one. */}
            <div className="preview-chart">
              <div className="chart-controls compare-controls">
                <span className="grid-info">
                  <strong>Compare with</strong>
                </span>
                {compareOptions.map((o) => (
                  <label key={o.week} className="series-check">
                    <input
                      type="checkbox"
                      checked={compareWeeks.includes(o.week)}
                      onChange={() => toggleCompare(o.week)}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
              <Chart
                labels={dayLabels.map((dl) => dl.dm)}
                series={[...overlaySeries, ...series]}
                unit="k"
                height={280}
                emphasis={dayLabels.map((dl) => dl.dow === 'Fri')}
                // The week edges and the day the horizon opens on carry the
                // axis; a date every nth day in between is one nobody chose.
                markedLabelsOnly
                slotValues={dayLabels.map((dl, d) => (dl.dow === 'Fri' ? netByDay[d] : null))}
              />
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
          existing={isOpenQuestion(requests[askTarget.cellKey]) ? requests[askTarget.cellKey] : null}
          flagged={submission?.flags.includes(askTarget.cellKey) ?? false}
          onClose={() => setAsking(null)}
        />
      )}
    </>
  );
}
