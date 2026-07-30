import { useMemo } from "react";
import { CyclePill, TopBar } from "../layout/TopBar";
import { StatusPill } from "../common/StatusPill";
import { Chart, CHART_COLORS, type ChartSeries } from "../common/Chart";
import { seedFor, STANDARD_TEMPLATE_ID } from "../../data/mockData";
import { listCycles, listEntities, seedUsers } from "../../data/appData";
import {
  currentWeekKey,
  dayLabelsForWeek,
  periodsOf,
  weekLabel,
} from "../../data/periods";
import {
  collectReviewGroups,
  consolidatedValues,
  getPriorValues,
  largestVariances,
  mergedEntityStatus,
  peekSubmission,
  templateForEntity,
} from "../../data/submissionService";
import type { SubmissionTarget } from "../submissions/Submission";
import { currentUser } from "../../data/session";
import {
  loadApprovals,
  loadCycles,
  loadSettings,
  loadSubmission,
  loadTemplates,
  loadUsers,
} from "../../storage/localStorage";
import { dayInflows, dayNet, dayOutflows } from "../submissions/gridMath";
import { emailForName, mailDomain, openEmail } from "../../utils/email";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import type { Entity, SubmissionStatus } from "../../types";
import type { ModalId, ViewId } from "../../types/nav";

interface DashboardProps {
  onOpenModal: (id: ModalId) => void;
  onNavigate: (view: ViewId) => void;
  onOpenSubmission?: (target: SubmissionTarget) => void;
}

function Delta({ delta }: { delta: number | null }) {
  // No prior forecast to compare against: a percentage would be meaningless.
  if (delta === null) return <span className="delta">— no prior week</span>;
  const cls = delta > 0 ? "up" : delta < 0 ? "down" : "";
  const sign = delta > 0 ? "↑" : delta < 0 ? "↓" : "—";
  return (
    <span className={`delta ${cls}`}>
      {sign} {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

/** "3h ago" / "2d ago" from an ISO timestamp. */
function agoLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "now";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function Dashboard({
  onOpenModal,
  onNavigate,
  onOpenSubmission,
}: DashboardProps) {
  const cycles = loadCycles(listCycles());
  // Stable per mount; the screen remounts (dataVersion) whenever stores change.
  const entities = useMemo(() => listEntities(), []);
  const activeCycle = cycles.find((c) => c.status === "submitted") ?? cycles[0];
  const overrides = loadApprovals(activeCycle?.id ?? "CW-2026-21");
  const week = currentWeekKey();
  const allTemplates = useMemo(() => loadTemplates(), []);
  // Display template for the consolidated grid; each entity is still read on
  // whatever template Legal Entity Setup gives it.
  const template = useMemo(
    () =>
      allTemplates.find((t) => t.id === STANDARD_TEMPLATE_ID) ??
      allTemplates[0] ??
      null,
    [allTemplates],
  );
  const entityTemplate = (name: string) =>
    templateForEntity(allTemplates, name);

  const statusOf = (e: Entity): SubmissionStatus =>
    mergedEntityStatus(e, week, entityTemplate(e.name)?.id ?? "", overrides);

  // --- KPIs computed from the data stores -------------------------------
  /**
   * Every entity's own forecast total for the week, from the same stored
   * submissions the Submission screen edits. These used to read the seeded
   * `entity.total`, so the headline KPI and the region table never moved
   * when a forecast changed while the KPI beside them did.
   */
  const entityTotals = useMemo(() => {
    const out = new Map<string, { total: number; prior: number }>();
    for (const e of entities) {
      const t = entityTemplate(e.name);
      if (!t) {
        out.set(e.name, { total: 0, prior: 0 });
        continue;
      }
      const periods = periodsOf(t).count;
      const cats = t.categories.length;
      const sub = peekSubmission(e.name, week, t);
      const priorValues = getPriorValues(e.name, week, t);
      let total = 0;
      let prior = 0;
      for (let d = 0; d < periods; d++) {
        total += dayNet(cats, sub.values, d);
        prior += dayNet(cats, priorValues, d);
      }
      out.set(e.name, { total, prior });
    }
    return out;
  }, [entities, allTemplates, week]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalOf = (name: string) => entityTotals.get(name)?.total ?? 0;
  const deltaOf = (name: string) => {
    const row = entityTotals.get(name);
    if (!row || row.prior === 0) return null;
    return ((row.total - row.prior) / Math.abs(row.prior)) * 100;
  };

  const totalForecast =
    entities.reduce((s, e) => s + totalOf(e.name), 0) / 1000;
  const priorTotal = entities.reduce(
    (s, e) => s + (entityTotals.get(e.name)?.prior ?? 0),
    0,
  );
  const weightedDelta =
    priorTotal === 0
      ? null
      : ((totalForecast * 1000 - priorTotal) / Math.abs(priorTotal)) * 100;

  // Consolidated across ALL entities from the same data the Submission
  // screen edits — recomputed on mount, so edits show up here immediately.
  const consolidated = useMemo(
    () => (template ? consolidatedValues(week, template) : null),
    [template, week],
  );
  const numCats = template?.categories.length ?? 0;

  const numPeriods = periodsOf(template).count;
  const netPosition = useMemo(() => {
    if (!consolidated) return 0;
    let net = 0;
    for (let d = 0; d < numPeriods; d++)
      net += dayNet(numCats, consolidated.values, d);
    return net / 1000;
  }, [consolidated, numCats, numPeriods]);

  const received = entities.filter((e) => statusOf(e) !== "pending").length;
  const pendingApproval = entities.filter(
    (e) => statusOf(e) === "submitted",
  ).length;

  const { flagCount, needComment } = useMemo(() => {
    // Same coverage as the Comments Review screen: every entity's current
    // week (stored submission or the deterministic demo data).
    let flags = 0;
    let missing = 0;
    for (const e of entities) {
      const t = entityTemplate(e.name);
      if (!t) continue;
      const sub = peekSubmission(e.name, week, t);
      flags += sub.flags.length;
      missing += sub.flags.filter((k) => !sub.comments?.[k]?.trim()).length;
    }
    return { flagCount: flags, needComment: missing };
  }, [entities, allTemplates, week]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- 4-week outlook chart from the consolidated grid ------------------
  const dayLabels = useMemo(() => dayLabelsForWeek(week), [week]);
  const outlookSeries: ChartSeries[] = useMemo(() => {
    if (!consolidated) return [];
    const inflows = dayLabels.map((_dl, d) =>
      dayInflows(numCats, consolidated.values, d),
    );
    const outflows = dayLabels.map((_dl, d) =>
      dayOutflows(numCats, consolidated.values, d),
    );
    const net = dayLabels.map((_dl, d) =>
      dayNet(numCats, consolidated.values, d),
    );
    return [
      {
        label: "Inflows",
        values: inflows,
        color: CHART_COLORS.green,
        kind: "bar",
      },
      {
        label: "Outflows",
        values: outflows,
        color: CHART_COLORS.red,
        kind: "bar",
      },
      {
        label: "Net Cash Flow",
        values: net,
        color: CHART_COLORS.accent,
        kind: "line",
      },
    ];
  }, [consolidated, dayLabels, numCats]);

  // --- Requires Attention: what Treasury needs to act on right now -------
  const attention = useMemo(() => {
    const effective = (e: Entity) =>
      mergedEntityStatus(e, week, entityTemplate(e.name)?.id ?? "", overrides);
    const missing = entities.filter((e) => effective(e) === "pending");
    const awaiting = entities.filter((e) => effective(e) === "submitted");
    const reviewGroups = template ? collectReviewGroups(loadTemplates()) : [];
    const unresolved = reviewGroups.reduce((s, g) => s + g.unresolved, 0);
    const blocked = reviewGroups.filter((g) => g.unresolved > 0).length;
    const movements = template
      ? largestVariances(week, template, loadSettings(DEFAULT_SETTINGS), 3)
      : [];
    return { missing, awaiting, unresolved, blocked, movements };
    // entityTemplate is derived from allTemplates, which is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities, template, allTemplates, week, overrides]);

  // --- Region → country rollup for the progress table --------------------
  const regions = useMemo(() => {
    const effective = (e: Entity) =>
      template ? mergedEntityStatus(e, week, template.id, overrides) : e.status;
    const order: string[] = [];
    const byRegion = new Map<string, Entity[]>();
    for (const e of entities) {
      if (!byRegion.has(e.region)) {
        byRegion.set(e.region, []);
        order.push(e.region);
      }
      byRegion.get(e.region)!.push(e);
    }
    return order.map((name) => {
      const members = byRegion.get(name)!;
      return {
        name,
        members,
        total: members.reduce((s, e) => s + totalOf(e.name), 0),
        received: members.filter((e) => effective(e) !== "pending").length,
      };
    });
  }, [entities, overrides, allTemplates, week, entityTotals]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Last-updated label: real timestamp when a submission exists, otherwise
   * a stable demo value derived from the entity name. */
  const updatedLabel = (entityName: string): string => {
    const t = entityTemplate(entityName);
    if (t) {
      const stored = loadSubmission(week, entityName, t.id);
      if (stored?.updatedAt) return agoLabel(stored.updatedAt);
    }
    return `${(seedFor(entityName) % 26) + 1}h ago`;
  };

  const sendChaser = (e: Entity) => {
    const me = currentUser();
    const domain = mailDomain(loadSettings(DEFAULT_SETTINGS));
    const users = loadUsers(seedUsers());
    openEmail({
      to: [
        emailForName(e.submitter, users, domain),
        emailForName(e.approver, users, domain),
      ],
      subject: `Reminder — ${activeCycle?.id ?? "current cycle"} cash flow forecast (${e.name})`,
      body:
        `Hi ${e.submitter.split(" ")[0]}, hi ${e.approver.split(" ")[0]},\n\n` +
        `Gentle reminder that the ${e.name} cash flow forecast for cycle ` +
        `${activeCycle?.id ?? "—"} (${weekLabel(week)}) is still ${statusOf(e)}.\n` +
        `The cycle closes ${activeCycle?.closes ?? "soon"}.\n\n` +
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
            <CyclePill label="Active Cycle" value={activeCycle?.id ?? "—"} />
            <button
              className="btn btn-ghost"
              onClick={() => onOpenModal("export")}
            >
              Export
            </button>
            <button
              className="btn btn-primary"
              onClick={() => onOpenModal("newCycle")}
            >
              + New Cycle
            </button>
          </>
        }
      />
      <div className="content">
        <div className="kpi-grid" data-tour="dashboard-kpis">
          <div className="kpi-card">
            <div className="kpi-label">Total Forecast · 4wk</div>
            <div className="kpi-value">€ {totalForecast.toFixed(1)}M</div>
            <div className="kpi-sub">
              <Delta delta={weightedDelta} /> vs prior cycle
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Net Cash Position</div>
            <div className="kpi-value">€ {netPosition.toFixed(1)}M</div>
            <div className="kpi-sub text-dim">
              {weekLabel(week)} consolidated
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Submissions Received</div>
            <div className="kpi-value">
              {received} / {entities.length}
            </div>
            <div className="kpi-sub text-dim">
              {pendingApproval} pending approval
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Variance Flags</div>
            <div className="kpi-value">{flagCount}</div>
            <div className="kpi-sub text-dim">
              {needComment} require commentary
            </div>
          </div>
        </div>

        <div className="section-header">
          <h2 data-tour="requires-attention">Requires Attention</h2>
          <span className="tag">live across all entities</span>
        </div>
        <div className="panel">
          <div className="panel-body no-pad">
            <div className="attention-row">
              <span className="badge-num warn">{attention.missing.length}</span>
              <div className="attention-text">
                <strong>Missing submissions</strong>
                <span className="text-dim">
                  {attention.missing.length === 0
                    ? "Every entity has submitted."
                    : attention.missing.map((e) => e.name).join(", ")}
                </span>
              </div>
              {attention.missing.length > 0 && (
                <button
                  className="btn btn-ghost"
                  style={{ padding: "4px 10px", fontSize: 11 }}
                  title="Opens a prefilled reminder email in Outlook"
                  onClick={() => sendChaser(attention.missing[0])}
                >
                  Chase {attention.missing[0].name}
                </button>
              )}
            </div>
            <div className="attention-row">
              <span className="badge-num">{attention.awaiting.length}</span>
              <div className="attention-text">
                <strong>Forecasts awaiting approval</strong>
                <span className="text-dim">
                  {attention.awaiting.length === 0
                    ? "Approval queue is clear."
                    : attention.awaiting.map((e) => e.name).join(", ")}
                </span>
              </div>
              <button
                className="btn btn-ghost"
                style={{ padding: "4px 10px", fontSize: 11 }}
                onClick={() => onNavigate("approvals")}
              >
                Open Approvals
              </button>
            </div>
            <div className="attention-row">
              <span className="badge-num warn">{attention.unresolved}</span>
              <div className="attention-text">
                <strong>Unresolved comments</strong>
                <span className="text-dim">
                  {attention.unresolved === 0
                    ? "Nothing blocking cycle close."
                    : `${attention.blocked} forecast${attention.blocked === 1 ? "" : "s"} blocked until reviewed.`}
                </span>
              </div>
              <button
                className="btn btn-ghost"
                style={{ padding: "4px 10px", fontSize: 11 }}
                onClick={() => onNavigate("review")}
              >
                Review Comments
              </button>
            </div>
            {attention.movements.map((m) => (
              <div
                className="attention-row"
                key={`${m.entity}-${m.category}-${m.dayIdx}`}
              >
                <span
                  className={`delta ${m.pct > 0 ? "up" : "down"}`}
                  style={{ fontFamily: "var(--mono)", fontSize: 12 }}
                >
                  {m.pct > 0 ? "+" : ""}
                  {m.pct.toFixed(0)}%
                </span>
                <div className="attention-text">
                  <strong>
                    {m.entity} · {m.category}
                  </strong>
                  <span className="text-dim">
                    Week-over-week move: €{m.prior.toLocaleString()}k → €
                    {m.current.toLocaleString()}k (day {m.dayIdx + 1})
                    {m.comment ? ` — “${m.comment}”` : " — no commentary yet"}
                  </span>
                </div>
                {onOpenSubmission && (
                  <button
                    className="btn btn-ghost"
                    style={{ padding: "4px 10px", fontSize: 11 }}
                    onClick={() =>
                      onOpenSubmission({
                        entity: m.entity,
                        week,
                        templateId: entityTemplate(m.entity)?.id,
                        // Open the flagged cell's dialog, not just the screen.
                        focusCell: `${m.catIdx}-${m.dayIdx}`,
                      })
                    }
                  >
                    Open Forecast
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Wrapper so the walkthrough highlights the whole region → country
            section, header and table together, rather than just its title. */}
        <div data-tour="cycle-progress">
          <div className="section-header">
            <h2>Cycle Progress · Region → Country</h2>
            <span className="tag">
              {activeCycle?.id ?? "—"} · Closes {activeCycle?.closes ?? "—"}
            </span>
          </div>

          <div className="panel">
            <div className="panel-body no-pad">
              <table>
                <thead>
                  <tr>
                    <th>Entity / Team</th>
                    <th>Submitter</th>
                    <th>Approver</th>
                    <th>Status</th>
                    <th className="num">Total (€)</th>
                    <th className="num">Δ vs Prior</th>
                    <th>Updated</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {regions.map((region) => (
                    <RegionRows
                      key={region.name}
                      region={region}
                      statusOf={statusOf}
                      totalOf={totalOf}
                      deltaOf={deltaOf}
                      updatedLabel={updatedLabel}
                      sendChaser={sendChaser}
                      week={week}
                      onOpenSubmission={onOpenSubmission}
                      onNavigate={onNavigate}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="section-header">
          <h2>4-Week Outlook</h2>
          <span className="tag">Consolidated · all entities · €k</span>
        </div>
        <div className="panel">
          <Chart
            labels={dayLabels.map((dl) => dl.dm)}
            series={outlookSeries}
            unit="k"
          />
        </div>
      </div>
    </div>
  );
}

interface RegionRowsProps {
  region: { name: string; members: Entity[]; total: number; received: number };
  statusOf: (e: Entity) => SubmissionStatus;
  /** Live forecast total for an entity, from its stored submission. */
  totalOf: (entityName: string) => number;
  /** Week-over-week delta, or null when there is no prior week. */
  deltaOf: (entityName: string) => number | null;
  updatedLabel: (entityName: string) => string;
  sendChaser: (e: Entity) => void;
  week: string;
  onOpenSubmission?: (target: SubmissionTarget) => void;
  onNavigate: (view: ViewId) => void;
}

/** One region band + its country rows (Region → Country drill-down). */
function RegionRows({
  region,
  statusOf,
  totalOf,
  deltaOf,
  updatedLabel,
  sendChaser,
  week,
  onOpenSubmission,
  onNavigate,
}: RegionRowsProps) {
  return (
    <>
      <tr className="region-row">
        <td>
          <strong>{region.name}</strong>
        </td>
        <td className="text-muted" style={{ fontSize: 11 }} colSpan={2}>
          {region.received} / {region.members.length} received
        </td>
        <td />
        <td className="num" style={{ fontWeight: 600 }}>
          €{Math.round(region.total).toLocaleString()}k
        </td>
        <td colSpan={3} />
      </tr>
      {region.members.map((e) => {
        const status = statusOf(e);
        return (
          <tr key={e.name}>
            <td style={{ paddingLeft: 32 }}>
              <strong>{e.name}</strong>
            </td>
            <td className="text-dim">{e.submitter}</td>
            <td className="text-dim">{e.approver}</td>
            <td>
              <StatusPill status={status} />
            </td>
            <td className="num">
              €{Math.round(totalOf(e.name)).toLocaleString()}k
            </td>
            <td className="num">
              <Delta delta={deltaOf(e.name)} />
            </td>
            <td className="text-muted" style={{ fontSize: 12 }}>
              {updatedLabel(e.name)}
            </td>
            <td>
              <div className="row-flex">
                <button
                  className="btn btn-ghost"
                  style={{ padding: "4px 10px", fontSize: 11 }}
                  onClick={() =>
                    onOpenSubmission
                      ? onOpenSubmission({ entity: e.name, week })
                      : onNavigate("submission")
                  }
                >
                  View
                </button>
                {status !== "approved" && (
                  <button
                    className="btn btn-ghost"
                    style={{ padding: "4px 10px", fontSize: 11 }}
                    title="Opens a prefilled reminder email in Outlook"
                    onClick={() => sendChaser(e)}
                  >
                    Send Chaser
                  </button>
                )}
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}
