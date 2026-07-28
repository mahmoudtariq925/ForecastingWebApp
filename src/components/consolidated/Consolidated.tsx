import { useMemo, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { useDialog } from '../common/dialogContext';
import { ForecastGrid } from '../submissions/ForecastGrid';
import {
  dayInflows,
  dayNet,
  dayOutflows,
  runningBalance,
  type GridValues,
} from '../submissions/gridMath';
import { STANDARD_TEMPLATE_ID } from '../../data/mockData';
import { listCycles, listEntities, seedUsers } from '../../data/appData';
import {
  currentWeekKey,
  dayLabelsForWeek,
  horizonDates,
  prevWeekKey,
  weekLabel,
  weekLabelShort,
} from '../../data/periods';
import { consolidatedValues } from '../../data/submissionService';
import { currentUser } from '../../data/session';
import { loadCycles, loadTemplates, loadUsers, saveCycles } from '../../storage/localStorage';
import { exportSubmissionXlsx } from '../../utils/excel';
import { appUrl, openEmail } from '../../utils/email';

const EMPTY_FLAGS = new Set<string>();

/**
 * Treasury read-only consolidated view: the cell-wise sum of every entity's
 * submission for the current week (stored submissions where they exist,
 * deterministic demo data otherwise) — the same numbers the Dashboard KPIs
 * and Comparisons screen derive from.
 */
export function Consolidated() {
  const week = currentWeekKey();
  const template = useMemo(() => {
    const templates = loadTemplates();
    return templates.find((t) => t.id === STANDARD_TEMPLATE_ID) ?? templates[0] ?? null;
  }, []);
  const dayLabels = useMemo(() => dayLabelsForWeek(week), [week]);
  const numDays = dayLabels.length;
  const numCats = template?.categories.length ?? 0;
  const [cycles, setCycles] = useState(() => loadCycles(listCycles()));
  const { confirm, notify } = useDialog();
  const activeCycle = cycles.find((c) => c.status === 'submitted');

  const current = useMemo(
    () => (template ? consolidatedValues(week, template) : null),
    [template, week],
  );
  const prior = useMemo(
    () => (template ? consolidatedValues(prevWeekKey(week), template) : null),
    [template, week],
  );

  const kpis = useMemo(() => {
    if (!current || !prior) return null;
    const sum = (fn: (v: GridValues, d: number) => number, v: GridValues) => {
      let s = 0;
      for (let d = 0; d < numDays; d++) s += fn(v, d);
      return s;
    };
    const values = current.values;
    const priorValues = prior.values;
    const inflows = sum((v, d) => dayInflows(numCats, v, d), values);
    const outflows = sum((v, d) => dayOutflows(numCats, v, d), values);
    const net = sum((v, d) => dayNet(numCats, v, d), values);
    const pInflows = sum((v, d) => dayInflows(numCats, v, d), priorValues);
    const pOutflows = sum((v, d) => dayOutflows(numCats, v, d), priorValues);
    const pNet = sum((v, d) => dayNet(numCats, v, d), priorValues);
    // No prior data (a live instance's first week): a percentage against
    // zero is meaningless, so signal "no comparison" instead of a huge number.
    const pct = (cur: number, prev: number): number | null =>
      prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100;

    let minBalance = Infinity;
    let minDay = 1;
    for (let d = 0; d < numDays; d++) {
      const bal = runningBalance(numCats, values, current.startingBalance, d);
      if (bal < minBalance) {
        minBalance = bal;
        minDay = d + 1;
      }
    }
    return {
      inflows,
      outflows,
      net,
      inflowsDelta: pct(inflows, pInflows),
      outflowsDelta: pct(Math.abs(outflows), Math.abs(pOutflows)),
      netDelta: pct(net, pNet),
      minBalance,
      minDay,
    };
  }, [current, prior, numCats, numDays]);

  const fmtM = (v: number) => `€ ${(v / 1000).toFixed(1)}M`;
  const deltaPill = (v: number | null) =>
    v === null ? (
      <span className="delta">— no prior week</span>
    ) : (
      <span className={`delta ${v >= 0 ? 'up' : 'down'}`}>
        {v >= 0 ? '↑' : '↓'} {Math.abs(v).toFixed(1)}%
      </span>
    );

  const closeCycle = async () => {
    if (!activeCycle) {
      await notify({ message: 'No open cycle to close.', tone: 'error' });
      return;
    }
    const confirmed = await confirm({
      title: 'Close forecast cycle',
      message: `Close cycle ${activeCycle.id}? This will lock all submissions for the cycle.`,
      confirmLabel: 'Close Cycle',
    });
    if (!confirmed) return;
    const next = cycles.map((c) =>
      c.id === activeCycle.id ? { ...c, status: 'consolidated' as const } : c,
    );
    setCycles(next);
    saveCycles(next);
    await notify({
      tone: 'success',
      message: `Cycle ${activeCycle.id} closed. Final consolidated forecast archived.`,
    });
  };

  const exportXlsx = () => {
    if (!template || !current) return;
    exportSubmissionXlsx({
      template,
      layout: 'days-across',
      entity: 'Consolidated (all entities)',
      weekLabel: weekLabelShort(week),
      dates: horizonDates(week),
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
    if (!kpis || !current) return;
    const me = currentUser();
    // Treasury colleagues (excluding the sender) get the summary.
    const recipients = loadUsers(seedUsers())
      .filter((u) => u.role === 'treasury' && u.email !== me.email)
      .map((u) => u.email);
    openEmail({
      to: recipients,
      subject: `Consolidated cash flow forecast — ${weekLabel(week)}`,
      body:
        `Hi team,\n\n` +
        `Consolidated 4-week forecast across ${listEntities().length} entities for ${weekLabel(week)}` +
        `${activeCycle ? ` (cycle ${activeCycle.id})` : ''}:\n\n` +
        `Total inflows: ${fmtM(kpis.inflows)}\n` +
        `Total outflows: ${fmtM(Math.abs(kpis.outflows))}\n` +
        `Net cash flow: ${fmtM(kpis.net)}\n` +
        `Minimum balance: ${fmtM(kpis.minBalance)} on day ${kpis.minDay}\n\n` +
        `Full detail: ${appUrl()}\n\n` +
        `Best regards,\n${me.name}\n${me.email}`,
    });
  };

  if (!template || !current || !kpis) {
    return (
      <div className="view active">
        <TopBar crumb="Treasury" title="Consolidated Forecast" />
        <div className="content">
          <div className="panel">
            <div className="empty-state">
              <div className="ic">▦</div>
              <p>No forecast templates available. Upload one under Admin → Templates.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view active">
      <TopBar
        crumb={`Treasury · ${activeCycle?.id ?? weekLabel(week)}`}
        title="Consolidated Forecast"
        actions={
          <>
            <button className="btn btn-ghost" onClick={exportXlsx}>
              Export XLSX
            </button>
            <button className="btn btn-ghost" onClick={emailSummary}>
              Email Summary
            </button>
            <button className="btn btn-success" onClick={closeCycle}>
              Close Cycle
            </button>
          </>
        }
      />
      <div className="content">
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Inflows · 4wk</div>
            <div className="kpi-value">{fmtM(kpis.inflows)}</div>
            <div className="kpi-sub">{deltaPill(kpis.inflowsDelta)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Outflows · 4wk</div>
            <div className="kpi-value">{fmtM(Math.abs(kpis.outflows))}</div>
            <div className="kpi-sub">{deltaPill(kpis.outflowsDelta)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Net · 4wk</div>
            <div className="kpi-value">{fmtM(kpis.net)}</div>
            <div className="kpi-sub">{deltaPill(kpis.netDelta)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Min Balance</div>
            <div className="kpi-value">{fmtM(kpis.minBalance)}</div>
            <div className="kpi-sub text-dim">on day {kpis.minDay}</div>
          </div>
        </div>

        <div className="section-header">
          <h2>Consolidated Grid</h2>
          <span className="tag">All entities · live submissions · {weekLabel(week)}</span>
        </div>
        <div className="panel">
          <div className="grid-toolbar">
            <div className="grid-info">
              <strong>{current.entityCount} entities consolidated</strong> ·{' '}
              <span className="text-muted">
                read-only · stored submissions + demo data for entities not yet started
              </span>
            </div>
          </div>
          <div className="forecast-grid-wrap">
            <ForecastGrid
              categories={template.categories}
              layout="days-across"
              dayLabels={dayLabels}
              values={current.values}
              flags={EMPTY_FLAGS}
              startingBalance={current.startingBalance}
              editable={false}
              showColumnTotals={template.columnTotals === true}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
