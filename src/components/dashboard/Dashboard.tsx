import { useMemo, useState } from 'react';
import { CyclePill, TopBar } from '../layout/TopBar';
import { Chart, CHART_COLORS, type ChartSeries } from '../common/Chart';
import { CycleProgressModal } from './CycleProgressModal';
import { AttentionModal } from './AttentionModal';
import { ConsolidatedModal } from './ConsolidatedModal';
import { DayBreakdownModal } from './DayBreakdownModal';
import { STANDARD_TEMPLATE_ID } from '../../data/mockData';
import { listCycles, seedUsers } from '../../data/appData';
import {
  currentWeekKey,
  periodsOf,
  rollShift,
  shiftWeeks,
  templateDayLabels,
  weekLabel,
  weekLabelShort,
} from '../../data/periods';
import {
  allCountries,
  attentionRows,
  cycleProgress,
  filterRegions,
} from '../../data/dashboardService';
import { consolidatedValues } from '../../data/submissionService';
import type { SubmissionTarget } from '../submissions/Submission';
import { currentUser } from '../../data/session';
import {
  loadApprovals,
  loadCycles,
  loadSettings,
  loadTemplates,
  loadUsers,
} from '../../storage/localStorage';
import { dayInflows, dayNet, dayOutflows } from '../submissions/gridMath';
import { emailForName, mailDomain, openEmail } from '../../utils/email';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { Entity } from '../../types';
import type { ModalId } from '../../types/nav';

interface DashboardProps {
  onOpenModal: (id: ModalId) => void;
  onOpenSubmission?: (target: SubmissionTarget) => void;
}

/** Which stat box (if any) has its modal open. */
type StatModal = 'received' | 'awaiting' | 'attention' | null;

/** How many prior cycles can be overlaid — beyond four there is no overlap. */
const COMPARE_DEPTH = 4;

/** Distinct from the live series so an overlay is never read as this cycle. */
const OVERLAY_COLORS = ['#8e92a3', '#7a5ea8', '#4f8a8b', '#a86b3c'];

/**
 * The treasury workspace, on one page.
 *
 * Cycle progress, the consolidated forecast and forecast-vs-forecast used to
 * be three screens; each answered a question you could only ask after leaving
 * the one before it. They are now one page — three stat boxes and a single
 * outlook chart — with the detail behind modals opened from whichever number
 * raised the question. Nothing else lives here on purpose: the page is meant
 * to be read without scrolling.
 */
export function Dashboard({ onOpenModal, onOpenSubmission }: DashboardProps) {
  const week = currentWeekKey();
  const cycles = loadCycles(listCycles());
  const activeCycle = cycles.find((c) => c.status === 'submitted') ?? cycles[0];
  const overrides = loadApprovals(activeCycle?.id ?? 'CW-2026-21');
  const settings = useMemo(() => loadSettings(DEFAULT_SETTINGS), []);

  const allTemplates = useMemo(() => loadTemplates(), []);
  // Display template for every consolidated figure; each entity is still read
  // on whatever template Legal Entity Setup gives it.
  const template = useMemo(
    () => allTemplates.find((t) => t.id === STANDARD_TEMPLATE_ID) ?? allTemplates[0] ?? null,
    [allTemplates],
  );

  const [statModal, setStatModal] = useState<StatModal>(null);
  const [consolidatedOpen, setConsolidatedOpen] = useState(false);
  const [dayIdx, setDayIdx] = useState<number | null>(null);
  /** Prior cycles overlaid on the outlook chart (forecast vs forecast). */
  const [compareWeeks, setCompareWeeks] = useState<string[]>([]);

  // ---- One rollup drives the stat boxes AND both progress modals ----------
  const regions = useMemo(
    () => cycleProgress(week, overrides),
    // overrides is a fresh object per render; its cycle id is the real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [week, activeCycle?.id, allTemplates],
  );
  const countries = useMemo(() => allCountries(regions), [regions]);
  const received = countries.filter((c) => c.received).length;
  const awaiting = countries.filter((c) => c.received && !c.approved).length;

  const attention = useMemo(
    () => attentionRows(week, settings),
    [week, settings],
  );
  const openComments = attention.reduce((s, r) => s + r.needCommentary, 0);

  // ---- 4-week outlook, consolidated across every entity -------------------
  const dayLabels = useMemo(() => templateDayLabels(template, week), [template, week]);
  const numCats = template?.categories.length ?? 0;
  const numPeriods = periodsOf(template).count;

  const outlookSeries: ChartSeries[] = useMemo(() => {
    if (!template) return [];
    const { values } = consolidatedValues(week, template);
    return [
      {
        label: 'Inflows',
        values: dayLabels.map((_dl, d) => dayInflows(numCats, values, d)),
        color: CHART_COLORS.green,
        kind: 'bar',
      },
      {
        label: 'Outflows',
        values: dayLabels.map((_dl, d) => dayOutflows(numCats, values, d)),
        color: CHART_COLORS.red,
        kind: 'bar',
      },
      {
        label: 'Net Cash Flow',
        values: dayLabels.map((_dl, d) => dayNet(numCats, values, d)),
        color: CHART_COLORS.accent,
        kind: 'line',
      },
    ];
  }, [template, week, dayLabels, numCats]);

  // Forecast vs forecast, folded into the same axes: each selected cycle adds
  // its net line, aligned on the calendar days the two horizons share.
  const compareOptions = useMemo(
    () =>
      Array.from({ length: COMPARE_DEPTH }, (_v, i) => {
        const key = shiftWeeks(week, -(i + 1));
        return { week: key, label: weekLabelShort(key) };
      }),
    [week],
  );
  const overlaySeries: ChartSeries[] = useMemo(() => {
    if (!template) return [];
    // Horizons roll forward one week per cycle, so a forecast N weeks back
    // covers this week's day d at its own day d + N·rollShift. Past that its
    // horizon ran out — a gap, not a zero.
    const step = rollShift(template);
    return compareWeeks.map((key, i) => {
      const past = consolidatedValues(key, template);
      const back = compareOptions.findIndex((o) => o.week === key) + 1;
      return {
        label: `${weekLabelShort(key)} · net`,
        values: dayLabels.map((_dl, d) => {
          const from = d + back * step;
          return from >= numPeriods ? null : dayNet(numCats, past.values, from);
        }),
        color: OVERLAY_COLORS[i % OVERLAY_COLORS.length],
        kind: 'line' as const,
        dashed: true,
      };
    });
  }, [compareWeeks, template, dayLabels, numCats, numPeriods, compareOptions]);

  const toggleCompare = (key: string) =>
    setCompareWeeks((prev) =>
      prev.includes(key) ? prev.filter((w) => w !== key) : [...prev, key],
    );

  // ---- Actions the progress modals hand back ------------------------------
  const openForecast = (target: { entity: string; templateId?: string; focusCell?: string }) =>
    onOpenSubmission?.({ ...target, week });

  const sendChaser = (e: Entity) => {
    const me = currentUser();
    const domain = mailDomain(settings);
    const users = loadUsers(seedUsers());
    openEmail({
      to: [emailForName(e.submitter, users, domain), emailForName(e.approver, users, domain)],
      subject: `Reminder — ${activeCycle?.id ?? 'current cycle'} cash flow forecast (${e.name})`,
      body:
        `Hi ${e.submitter.split(' ')[0]}, hi ${e.approver.split(' ')[0]},\n\n` +
        `Gentle reminder that the ${e.name} cash flow forecast for cycle ` +
        `${activeCycle?.id ?? '—'} (${weekLabel(week)}) is still outstanding.\n` +
        `The cycle closes ${activeCycle?.closes ?? 'soon'}.\n\n` +
        `Submit or approve it here: ${window.location.origin + window.location.pathname}\n\n` +
        `Best regards,\n${me.name}\n${me.email}`,
    });
  };

  return (
    <div className="view active">
      <TopBar
        crumb="Overview"
        title="Treasury Dashboard"
        actions={
          <>
            <CyclePill label="Active Cycle" value={activeCycle?.id ?? '—'} />
            <button className="btn btn-ghost" onClick={() => onOpenModal('export')}>
              Export
            </button>
            <button className="btn btn-primary" onClick={() => onOpenModal('newCycle')}>
              + New Cycle
            </button>
          </>
        }
      />
      <div className="content content-compact">
        {/* Three numbers, each a door into the detail behind it. */}
        <div className="kpi-grid kpi-grid-3" data-tour="dashboard-kpis">
          <StatBox
            label="Submissions Received"
            value={`${received} / ${countries.length}`}
            sub={
              received === countries.length
                ? 'Every entity has submitted'
                : `${countries.length - received} still outstanding`
            }
            tone={received === countries.length ? 'ok' : 'warn'}
            dataTour="stat-received"
            onOpen={() => setStatModal('received')}
          />
          <StatBox
            label="Awaiting Approval"
            value={String(awaiting)}
            sub={awaiting === 0 ? 'Approval queue is clear' : 'Submitted, not yet approved'}
            tone={awaiting === 0 ? 'ok' : 'warn'}
            dataTour="stat-awaiting"
            onOpen={() => setStatModal('awaiting')}
          />
          <StatBox
            label="Requires Commentary"
            value={String(openComments)}
            sub={
              attention.length === 0
                ? 'Nothing blocking cycle close'
                : `Across ${attention.length} countr${attention.length === 1 ? 'y' : 'ies'}`
            }
            tone={openComments === 0 ? 'ok' : 'warn'}
            dataTour="stat-attention"
            onOpen={() => setStatModal('attention')}
          />
        </div>

        {/* The one chart on the page: consolidated outlook, prior cycles
            overlaid on demand, every column a door into its own breakdown. */}
        <div className="panel outlook-panel" data-tour="outlook-chart">
          <div className="grid-toolbar">
            <div className="grid-info">
              <strong>4-Week Outlook</strong>{' '}
              <span className="text-muted">
                consolidated · {weekLabelShort(week)} · €k · click a column for the country
                breakdown
              </span>
            </div>
            <button
              className="btn btn-ghost"
              data-tour="open-consolidated"
              onClick={() => setConsolidatedOpen(true)}
            >
              Consolidated Forecast
            </button>
          </div>
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
          {template ? (
            <Chart
              labels={dayLabels.map((dl) => dl.dm)}
              series={[...overlaySeries, ...outlookSeries]}
              unit="k"
              height={260}
              stacked
              onPointClick={setDayIdx}
            />
          ) : (
            <div className="empty-state">
              <div className="ic">▦</div>
              <p>No forecast templates available. Upload one under Admin → Templates.</p>
            </div>
          )}
        </div>
      </div>

      {/* ---------- Modals ---------- */}
      {statModal === 'received' && (
        <CycleProgressModal
          open
          title="Cycle Progress · Region → Country"
          subtitle={`${activeCycle?.id ?? '—'} · closes ${activeCycle?.closes ?? '—'}`}
          regions={regions}
          onClose={() => setStatModal(null)}
          onView={openForecast}
          onChase={sendChaser}
          emptyMessage="No entities are configured yet."
        />
      )}
      {statModal === 'awaiting' && (
        <CycleProgressModal
          open
          title="Awaiting Approval"
          subtitle={`Submitted but not yet approved · ${activeCycle?.id ?? '—'}`}
          regions={filterRegions(regions, (c) => c.received && !c.approved)}
          onClose={() => setStatModal(null)}
          onView={openForecast}
          onChase={sendChaser}
          emptyMessage="Every submitted forecast has been approved."
        />
      )}
      {statModal === 'attention' && (
        <AttentionModal
          open
          rows={attention}
          subtitle={`${weekLabel(week)} · largest unexplained move first`}
          onClose={() => setStatModal(null)}
          onOpen={(r) =>
            openForecast({ entity: r.entity, templateId: r.templateId, focusCell: r.worstCell })
          }
        />
      )}
      {consolidatedOpen && template && (
        <ConsolidatedModal
          open
          week={week}
          template={template}
          onClose={() => setConsolidatedOpen(false)}
        />
      )}
      {dayIdx !== null && (
        <DayBreakdownModal
          open
          week={week}
          dayIdx={dayIdx}
          dayLabel={
            dayLabels[dayIdx] ? `${dayLabels[dayIdx].dow} ${dayLabels[dayIdx].dm}` : `Day ${dayIdx + 1}`
          }
          onClose={() => setDayIdx(null)}
          onOpen={openForecast}
        />
      )}
    </div>
  );
}

/**
 * A headline number that opens its own detail. Same card as the stats it
 * replaces; the only addition is that the whole card is the button.
 */
function StatBox({
  label,
  value,
  sub,
  tone,
  dataTour,
  onOpen,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'ok' | 'warn';
  dataTour: string;
  onOpen: () => void;
}) {
  return (
    <button className={`kpi-card kpi-clickable tone-${tone}`} data-tour={dataTour} onClick={onOpen}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub text-dim">{sub}</div>
      <span className="kpi-open" aria-hidden="true">
        View →
      </span>
    </button>
  );
}
