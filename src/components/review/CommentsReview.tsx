import { useMemo, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import {
  collectReviewGroups,
  isOpenQuestion,
  requesterLabel,
  type ReviewGroup,
  type ReviewItem,
} from '../../data/submissionService';
import { weekLabel } from '../../data/periods';
import { activeWeekKey } from '../../data/cycleService';
import { useDataVersion } from '../../data/useDataVersion';
import { listEntities } from '../../data/appData';
import { loadTemplates } from '../../storage/localStorage';
import type { SubmissionTarget } from '../submissions/Submission';

const PAGE_SIZE = 8;

type StateFilter = 'unresolved' | 'needs-commentary' | 'resolved' | 'all';

const STATE_OPTIONS: { value: StateFilter; label: string }[] = [
  { value: 'unresolved', label: 'Still open' },
  { value: 'needs-commentary', label: 'Needs commentary' },
  { value: 'resolved', label: 'Closed by Treasury' },
  { value: 'all', label: 'All comments' },
];

const ALL = 'all';

interface CommentsReviewProps {
  onOpenSubmission?: (target: SubmissionTarget) => void;
  /** Restrict to these entities (analyst scoping); undefined = all. */
  scopeEntities?: string[];
  /**
   * Whether the user is the one who WRITES commentary (submitters). Approvers
   * and viewers read this screen: an Explain/Reply button would deep-link
   * them into a read-only grid with a disabled text box.
   */
  canExplain?: boolean;
}

function ItemStatePill({ item }: { item: ReviewItem }) {
  // An open question outranks everything else: someone is waiting on a reply.
  if (isOpenQuestion(item.request)) return <StatusPill status="rejected" label="awaiting reply" />;
  if (item.resolved) return <StatusPill status="approved" label="resolved" />;
  if (!item.comment) return <StatusPill status="draft" label="needs commentary" />;
  // A cell whose question came back reads as an ANSWER, not as commentary
  // that happened to appear: it is the one to read first.
  if (item.request) return <StatusPill status="submitted" label="answered" />;
  return <StatusPill status="submitted" label="awaiting review" />;
}

const fmtK = (v: number) => `${Math.round(v).toLocaleString()}`;

/**
 * The conversation on an analyst's own forecasts: every flagged cell they
 * have to explain, every question waiting on them and every answer they have
 * given, grouped per forecast, filterable and searchable.
 *
 * Treasury has its own screen (`QuestionsReview`) — a queue of the QUESTIONS
 * asked across the group. Reading every submitter's commentary was never
 * treasury's job, and at scale it buried the handful of things that were.
 */
export function CommentsReview({
  onOpenSubmission,
  scopeEntities,
  canExplain = true,
}: CommentsReviewProps) {
  const templates = useMemo(() => loadTemplates(), []);
  // This screen only reads; answering happens on the forecast. Following the
  // storage revision keeps it current when an answer is written over there.
  const version = useDataVersion();
  const groups = useMemo(() => {
    void version; // storage changed → recollect
    const all = collectReviewGroups(templates);
    return scopeEntities ? all.filter((g) => scopeEntities.includes(g.entity)) : all;
  }, [templates, version, scopeEntities]);

  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState(ALL);
  /**
   * Opens on the active cycle rather than on every week ever stored. Closed
   * cycles keep their commentary and are one dropdown away, but the question
   * on this screen is "what is holding up the cycle we are in".
   */
  const [periodFilter, setPeriodFilter] = useState(() => activeWeekKey());
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [submitterFilter, setSubmitterFilter] = useState(ALL);
  const [stateFilter, setStateFilter] = useState<StateFilter>('unresolved');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);

  /**
   * The summary counts the forecasts currently IN SCOPE, not every forecast
   * ever stored. With several closed cycles behind the open one, a total over
   * all history answered a question nobody was asking and buried the one they
   * were: how much is outstanding in the cycle on screen.
   */
  const inScope = useMemo(
    () =>
      groups.filter(
        (g) =>
          (periodFilter === ALL || g.period === periodFilter) &&
          (entityFilter === ALL || g.entity === entityFilter),
      ),
    [groups, periodFilter, entityFilter],
  );
  const totalUnresolved = inScope.reduce((s, g) => s + g.unresolved, 0);
  const totalNeedCommentary = inScope.reduce((s, g) => s + g.needsCommentary, 0);
  // Counted from the reader's side of the conversation: what is being asked
  // of them, what they have already said, and how much is still open.
  const openQuestions = inScope.reduce(
    (s, g) => s + g.items.filter((i) => isOpenQuestion(i.request)).length,
    0,
  );
  const totalAnswered = inScope.reduce(
    (s, g) => s + g.items.filter((i) => i.comment && !isOpenQuestion(i.request)).length,
    0,
  );

  // ---- Filter options derived from the data ----
  const options = useMemo(() => {
    const uniq = (vals: string[]) => [...new Set(vals)];
    return {
      entities: uniq(groups.map((g) => g.entity)).sort(),
      periods: uniq(groups.map((g) => g.period)).sort().reverse(),
      statuses: uniq(groups.map((g) => g.status)),
      submitters: uniq(groups.map((g) => g.submitter)).sort(),
    };
  }, [groups]);

  // ---- Apply filters + search; keep the matching items per group ----
  const filtered = useMemo(() => {
    const stateMatch = (i: ReviewItem): boolean => {
      switch (stateFilter) {
        case 'all':
          return true;
        case 'resolved':
          return i.resolved;
        case 'needs-commentary':
          return !i.resolved && !i.comment;
        case 'unresolved':
          return !i.resolved;
      }
    };
    const q = search.trim().toLowerCase();
    const out: { group: ReviewGroup; items: ReviewItem[] }[] = [];
    for (const g of groups) {
      if (entityFilter !== ALL && g.entity !== entityFilter) continue;
      if (periodFilter !== ALL && g.period !== periodFilter) continue;
      if (statusFilter !== ALL && g.status !== statusFilter) continue;
      if (submitterFilter !== ALL && g.submitter !== submitterFilter) continue;

      const groupText =
        `${g.entity} ${g.templateName} ${g.submitter} ${weekLabel(g.period)}`.toLowerCase();
      const groupHit = !q || groupText.includes(q);
      const items = g.items
        .filter(stateMatch)
        .filter(
          (i) =>
            groupHit ||
            i.category.toLowerCase().includes(q) ||
            i.comment.toLowerCase().includes(q),
        );
      const dayNotesVisible = stateFilter === 'all' && groupHit && g.dayNotes.length > 0;
      if (items.length > 0 || dayNotesVisible) out.push({ group: g, items });
    }
    return out;
  }, [groups, search, entityFilter, periodFilter, statusFilter, submitterFilter, stateFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const visibleComments = filtered.reduce((s, r) => s + r.items.length, 0);

  /**
   * Group the page into regions, countries inside a region ordered by their
   * largest variance. Treasury works the group from the top down — biggest
   * mover first — and a flat list of eighteen forecasts hides that ordering
   * completely.
   */
  const regionGroups = useMemo(() => {
    const regionOf = new Map(listEntities().map((e) => [e.name, e.region]));
    const worstPct = (items: ReviewItem[]) =>
      items.reduce((m, i) => Math.max(m, Math.abs(i.pct ?? 0)), 0);
    const order: string[] = [];
    const byRegion = new Map<string, { group: ReviewGroup; items: ReviewItem[] }[]>();
    for (const row of pageRows) {
      const region = regionOf.get(row.group.entity) ?? 'Unassigned';
      if (!byRegion.has(region)) {
        byRegion.set(region, []);
        order.push(region);
      }
      byRegion.get(region)!.push(row);
    }
    return order
      .map((name) => {
        const rows = byRegion
          .get(name)!
          .sort((a, b) => worstPct(b.items) - worstPct(a.items));
        return {
          name,
          rows,
          unresolved: rows.reduce((s, r) => s + r.group.unresolved, 0),
          needsCommentary: rows.reduce((s, r) => s + r.group.needsCommentary, 0),
          worstPct: worstPct(rows.flatMap((r) => r.items)),
        };
      })
      .sort((a, b) => b.worstPct - a.worstPct);
  }, [pageRows]);

  // Regions with nothing outstanding start folded away.
  const [closedRegions, setClosedRegions] = useState<Set<string>>(new Set());
  const toggleRegion = (name: string) =>
    setClosedRegions((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const resetPage = () => setPage(0);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="view active">
      <TopBar
        crumb="My Workspace"
        title="Comments &amp; Feedback"
        actions={
          <span className="tag" style={{ letterSpacing: '0.12em' }}>
            {openQuestions} question{openQuestions === 1 ? '' : 's'} waiting ·{' '}
            {totalNeedCommentary} to explain
          </span>
        }
      />
      <div className="content">
        {/* Counted from this reader's side: what is being asked of them and
            what they have already said. The old figures ("require admin
            review", "cannot be closed yet") were treasury's view of the same
            rows, on a screen treasury no longer opens. */}
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Questions Waiting</div>
            <div className="kpi-value">{openQuestions}</div>
            <div className="kpi-sub text-dim">asked by Treasury or your approver</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Variances To Explain</div>
            <div className="kpi-value">{totalNeedCommentary}</div>
            <div className="kpi-sub text-dim">flagged cells with no commentary yet</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Explained</div>
            <div className="kpi-value">{totalAnswered}</div>
            <div className="kpi-sub text-dim">commentary and answers you have given</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Still Open</div>
            <div className="kpi-value">{totalUnresolved}</div>
            <div className="kpi-sub text-dim">not yet closed off by Treasury</div>
          </div>
        </div>

        <div className="panel">
          <div className="grid-toolbar" data-tour="review-filters">
            <div className="grid-toolbar-left">
              <input
                className="form-input"
                style={{ width: 220 }}
                placeholder="Search entity, category, comment…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  resetPage();
                }}
                aria-label="Search comments"
              />
              <select
                className="form-select"
                style={{ width: 'auto' }}
                value={entityFilter}
                onChange={(e) => {
                  setEntityFilter(e.target.value);
                  resetPage();
                }}
                aria-label="Filter by entity"
              >
                <option value={ALL}>All entities</option>
                {options.entities.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
              <select
                className="form-select"
                style={{ width: 'auto' }}
                value={periodFilter}
                onChange={(e) => {
                  setPeriodFilter(e.target.value);
                  resetPage();
                }}
                aria-label="Filter by forecast period"
              >
                <option value={ALL}>All periods</option>
                {options.periods.map((p) => (
                  <option key={p} value={p}>
                    {weekLabel(p)}
                  </option>
                ))}
              </select>
              <select
                className="form-select"
                style={{ width: 'auto' }}
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  resetPage();
                }}
                aria-label="Filter by status"
              >
                <option value={ALL}>All statuses</option>
                {options.statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                className="form-select"
                style={{ width: 'auto' }}
                value={submitterFilter}
                onChange={(e) => {
                  setSubmitterFilter(e.target.value);
                  resetPage();
                }}
                aria-label="Filter by submitter"
              >
                <option value={ALL}>All submitters</option>
                {options.submitters.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                className="form-select"
                style={{ width: 'auto' }}
                value={stateFilter}
                onChange={(e) => {
                  setStateFilter(e.target.value as StateFilter);
                  resetPage();
                }}
                aria-label="Filter by comment state"
              >
                {STATE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid-info">
              <strong>{visibleComments}</strong> comment{visibleComments === 1 ? '' : 's'} in{' '}
              <strong>{filtered.length}</strong> forecast{filtered.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        {pageRows.length === 0 ? (
          <div className="panel">
            <div className="empty-state">
              <div className="ic">✓</div>
              <p>
                {groups.length === 0
                  ? 'Nothing to review — no current-week forecast has flagged cells or day comments.'
                  : 'Nothing matches the current filters — try "All comments" or clear the search.'}
              </p>
            </div>
          </div>
        ) : (
          regionGroups.map((region) => (
            <div className="review-region" key={region.name}>
              {/* Region band: one dropdown per region, biggest mover first,
                  so a group-wide queue can be worked one region at a time. */}
              <button
                className="review-region-head"
                aria-expanded={!closedRegions.has(region.name)}
                onClick={() => toggleRegion(region.name)}
              >
                <span className="review-caret">
                  {closedRegions.has(region.name) ? '▸' : '▾'}
                </span>
                <strong>{region.name}</strong>
                <span className="text-muted">
                  {region.rows.length} forecast{region.rows.length === 1 ? '' : 's'}
                </span>
                {region.needsCommentary > 0 && (
                  <span className="badge-num warn">{region.needsCommentary} need commentary</span>
                )}
                {region.unresolved > 0 && (
                  <span className="badge-num">{region.unresolved} unresolved</span>
                )}
                <span className="review-region-worst">
                  largest {region.worstPct.toFixed(0)}%
                </span>
              </button>
              {!closedRegions.has(region.name) &&
                region.rows.map(({ group: g, items }) => {
                  const isOpen = expanded.has(g.id);
                  return (
              // Blocked forecasts carry visual weight so the sort order
              // (most blocked first) is actually legible.
              <div className={`panel${g.unresolved > 0 ? ' review-blocked' : ''}`} key={g.id}>
                <div
                  className="review-head"
                  onClick={() => toggleExpanded(g.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleExpanded(g.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                >
                  <div className="review-meta">
                    <span className="review-caret">{isOpen ? '▾' : '▸'}</span>
                    <strong>{g.entity}</strong>
                    <span className="text-dim">{weekLabel(g.period)}</span>
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      {g.templateName}
                    </span>
                    <span className="text-dim" style={{ fontSize: 12 }}>
                      Submitter: {g.submitter}
                    </span>
                    <StatusPill status={g.status} />
                  </div>
                  <div className="review-meta">
                    {g.needsCommentary > 0 && (
                      <span className="badge-num warn">{g.needsCommentary} need commentary</span>
                    )}
                    {g.unresolved > 0 ? (
                      <span className="badge-num">{g.unresolved} unresolved</span>
                    ) : (
                      <span className="badge-num ok">all resolved</span>
                    )}
                    {onOpenSubmission && (
                      <button
                        className="btn btn-primary"
                        style={{ padding: '4px 10px', fontSize: 11 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenSubmission({
                            entity: g.entity,
                            week: g.period,
                            templateId: g.templateId,
                          });
                        }}
                      >
                        Open Forecast
                      </button>
                    )}
                  </div>
                </div>
                {isOpen && (
                  <div className="panel-body no-pad" style={{ borderTop: '1px solid var(--border)' }}>
                    {items.length > 0 && (
                      <table>
                        <thead>
                          <tr>
                            <th>State</th>
                            <th>Line Item</th>
                            <th>Date</th>
                            <th className="num">Current (€k)</th>
                            <th className="num">Prior (€k)</th>
                            <th className="num">Δ %</th>
                            <th>Commentary</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item) => (
                            <tr key={item.key}>
                              <td>
                                <ItemStatePill item={item} />
                              </td>
                              <td>
                                <strong>{item.category}</strong>
                              </td>
                              <td className="text-dim">{item.dateLabel}</td>
                              <td className="num">{fmtK(item.current)}</td>
                              <td className="num">
                                {item.prior === null ? '—' : fmtK(item.prior)}
                              </td>
                              <td className="num">
                                {item.pct === null ? (
                                  <span className="text-muted">new</span>
                                ) : (
                                  <span className={`delta ${item.pct > 0 ? 'up' : 'down'}`}>
                                    {item.pct > 0 ? '+' : ''}
                                    {item.pct.toFixed(1)}%
                                  </span>
                                )}
                              </td>
                              <td
                                className={item.comment ? 'text-dim' : 'text-muted'}
                                style={{ fontSize: 12, maxWidth: 300 }}
                              >
                                {/* The question stays beside the answer, so a
                                    paragraph of commentary is never read
                                    without knowing what was asked. */}
                                {item.request && (
                                  <div
                                    className="comment-request-note"
                                    style={{ marginTop: 0, marginBottom: 6 }}
                                  >
                                    <strong>
                                      {item.request.from} ({requesterLabel(item.request.fromRole)})
                                      asked:
                                    </strong>{' '}
                                    {item.request.message}
                                  </div>
                                )}
                                {item.comment ||
                                  (isOpenQuestion(item.request)
                                    ? 'Waiting on the submitter’s answer.'
                                    : 'No commentary provided yet.')}
                              </td>
                              <td>
                                {canExplain && (
                                  <button
                                    className="btn btn-ghost"
                                    style={{ padding: '4px 10px', fontSize: 11 }}
                                    title="Open the forecast to add your commentary"
                                    onClick={() =>
                                      onOpenSubmission?.({
                                        entity: g.entity,
                                        week: g.period,
                                        templateId: g.templateId,
                                        // Land on this exact cell with its
                                        // commentary dialog already open.
                                        focusCell: item.key,
                                      })
                                    }
                                  >
                                    {isOpenQuestion(item.request) ? 'Reply' : 'Explain'}
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {g.dayNotes.length > 0 && (
                      <div className="review-day-notes">
                        <div className="nav-label" style={{ padding: 0, marginBottom: 6 }}>
                          Day Notes (from the Comments column)
                        </div>
                        {g.dayNotes.map((n) => (
                          <div key={n.dayIdx} className="review-day-note">
                            <span className="text-muted" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                              {n.dateLabel}
                            </span>{' '}
                            <span className="text-dim">{n.text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
                  );
                })}
            </div>
          ))
        )}

        {pageCount > 1 && (
          <div className="pager">
            <span className="text-muted" style={{ fontSize: 12 }}>
              Page {safePage + 1} of {pageCount} · {filtered.length} forecasts
            </span>
            <button
              className="btn btn-ghost"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              ← Prev
            </button>
            <button
              className="btn btn-ghost"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Next →
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
