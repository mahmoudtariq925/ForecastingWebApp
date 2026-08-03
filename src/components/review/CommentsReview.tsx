import { useMemo, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { useDialog } from '../common/dialogContext';
import { Modal } from '../common/Modal';
import {
  collectReviewGroups,
  requestComment,
  resolveAllFlags,
  type ReviewGroup,
  type ReviewItem,
} from '../../data/submissionService';
import { weekLabel, weekLabelShort } from '../../data/periods';
import { seedUsers } from '../../data/appData';
import { currentUser } from '../../data/session';
import { listEntities } from '../../data/appData';
import { loadSettings, loadTemplates, loadUsers } from '../../storage/localStorage';
import { appUrl, emailForName, mailDomain, openEmail } from '../../utils/email';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { SubmissionTarget } from '../submissions/Submission';

const PAGE_SIZE = 8;

type StateFilter = 'unresolved' | 'needs-commentary' | 'resolved' | 'all';

const STATE_OPTIONS: { value: StateFilter; label: string }[] = [
  { value: 'unresolved', label: 'Unresolved' },
  { value: 'needs-commentary', label: 'Needs commentary' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All comments' },
];

const ALL = 'all';

interface CommentsReviewProps {
  onOpenSubmission?: (target: SubmissionTarget) => void;
  /** Restrict to these entities (analyst scoping); undefined = all. */
  scopeEntities?: string[];
  /** Whether the user may mark comments reviewed/resolved (admin/treasury). */
  canResolve?: boolean;
  /**
   * Whether the user is the one who WRITES commentary (submitters). Approvers
   * and viewers read this screen: an Explain/Reply button would deep-link
   * them into a read-only grid with a disabled text box.
   */
  canExplain?: boolean;
}

function ItemStatePill({ item }: { item: ReviewItem }) {
  // An open question outranks everything else: someone is waiting on a reply.
  if (item.request) return <StatusPill status="rejected" label="awaiting reply" />;
  if (item.resolved) return <StatusPill status="approved" label="resolved" />;
  if (!item.comment) return <StatusPill status="pending" label="needs commentary" />;
  return <StatusPill status="submitted" label="awaiting review" />;
}

const fmtK = (v: number) => `${Math.round(v).toLocaleString()}`;

/**
 * Admin screen for working through variance commentary at scale: every
 * stored forecast with flagged cells, grouped per forecast, filterable and
 * searchable, with per-comment and per-forecast resolution. A forecast stops
 * counting as blocked once all its flagged cells are resolved.
 */
export function CommentsReview({
  onOpenSubmission,
  scopeEntities,
  canResolve = true,
  canExplain = true,
}: CommentsReviewProps) {
  const templates = useMemo(() => loadTemplates(), []);
  const { confirm, notify } = useDialog();
  // Bumped after every write so the groups re-read from storage.
  const [version, setVersion] = useState(0);
  const groups = useMemo(() => {
    void version; // storage changed → recollect
    const all = collectReviewGroups(templates);
    return scopeEntities ? all.filter((g) => scopeEntities.includes(g.entity)) : all;
  }, [templates, version, scopeEntities]);

  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState(ALL);
  const [periodFilter, setPeriodFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [submitterFilter, setSubmitterFilter] = useState(ALL);
  const [stateFilter, setStateFilter] = useState<StateFilter>('unresolved');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);

  // ---- Global summary (independent of filters) ----
  const totalUnresolved = groups.reduce((s, g) => s + g.unresolved, 0);
  const blockedForecasts = groups.filter((g) => g.unresolved > 0).length;
  const totalNeedCommentary = groups.reduce((s, g) => s + g.needsCommentary, 0);
  const totalResolved = groups.reduce(
    (s, g) => s + g.items.filter((i) => i.resolved).length,
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

  const resetPage = () => setPage(0);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ---- Asking the submitter for (more) commentary ------------------------
  const [asking, setAsking] = useState<{ group: ReviewGroup; item: ReviewItem } | null>(null);
  const [askDraft, setAskDraft] = useState('');

  const openAsk = (group: ReviewGroup, item: ReviewItem) => {
    setAskDraft('');
    setAsking({ group, item });
  };

  const sendAsk = async () => {
    if (!asking) return;
    const message = askDraft.trim();
    if (!message) {
      await notify({ tone: 'error', message: 'Write the question you want answered first.' });
      return;
    }
    const { group, item } = asking;
    const me = currentUser();
    requestComment(group.period, group.entity, group.templateId, item.key, {
      from: me.name,
      message,
      requestedAt: new Date().toISOString(),
    });
    setAsking(null);
    setVersion((v) => v + 1);
    // The submitter is not sitting in the app waiting — tell them.
    const settings = loadSettings(DEFAULT_SETTINGS);
    const ent = listEntities().find((e) => e.name === group.entity);
    openEmail({
      to: ent ? emailForName(ent.submitter, loadUsers(seedUsers()), mailDomain(settings)) : '',
      subject: `Question on the ${group.entity} forecast — ${item.category} · ${item.dateLabel}`,
      body:
        `Hi ${ent?.submitter ?? 'there'},\n\n` +
        `I have a question about the ${group.entity} cash flow forecast for ` +
        `${weekLabel(group.period)}.\n\n` +
        `Line item: ${item.category}\n` +
        `Period: ${item.dateLabel}\n` +
        `Current value: ${fmtK(item.current)}\n` +
        (item.prior === null ? '' : `Prior forecast: ${fmtK(item.prior)}\n`) +
        (item.comment ? `\nYour commentary so far:\n${item.comment}\n` : '') +
        `\nQuestion:\n${message}\n\n` +
        `Please reply on that cell in Liquid: ${appUrl()}\n\n` +
        `Best regards,\n${me.name}\n${me.email}`,
    });
  };

  const resolveGroup = async (g: ReviewGroup) => {
    const confirmed = await confirm({
      title: 'Resolve all comments',
      message: `Mark all ${g.unresolved} unresolved comment${g.unresolved === 1 ? '' : 's'} for ${g.entity} · ${weekLabelShort(g.period)} as reviewed?`,
      confirmLabel: 'Resolve All',
    });
    if (!confirmed) return;
    resolveAllFlags(g.period, g.entity, g.templateId);
    setVersion((v) => v + 1);
  };

  return (
    <div className="view active">
      <TopBar
        crumb={canResolve ? 'Administration' : 'My Workspace'}
        title={canResolve ? 'Comments Review' : 'Comments & Feedback'}
        actions={
          <span className="tag" style={{ letterSpacing: '0.12em' }}>
            {totalUnresolved} unresolved comment{totalUnresolved === 1 ? '' : 's'} across{' '}
            {blockedForecasts} forecast{blockedForecasts === 1 ? '' : 's'}
          </span>
        }
      />
      <div className="content">
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Unresolved Comments</div>
            <div className="kpi-value">{totalUnresolved}</div>
            <div className="kpi-sub text-dim">require admin review</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Blocked Forecasts</div>
            <div className="kpi-value">{blockedForecasts}</div>
            <div className="kpi-sub text-dim">cannot be closed yet</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Awaiting Commentary</div>
            <div className="kpi-value">{totalNeedCommentary}</div>
            <div className="kpi-sub text-dim">submitter explanation missing</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Resolved</div>
            <div className="kpi-value">{totalResolved}</div>
            <div className="kpi-sub text-dim">reviewed &amp; cleared</div>
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
          pageRows.map(({ group: g, items }) => {
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
                    {canResolve && g.unresolved > 0 && (
                      <button
                        className="btn btn-ghost"
                        title="Mark every comment on this forecast as reviewed"
                        style={{ padding: '4px 10px', fontSize: 11 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          resolveGroup(g);
                        }}
                      >
                        Resolve All
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
                                {item.comment || 'No commentary provided yet.'}
                                {item.request && (
                                  <div className="comment-request-note" style={{ marginTop: 6 }}>
                                    <strong>{item.request.from} asked:</strong>{' '}
                                    {item.request.message}
                                  </div>
                                )}
                              </td>
                              <td>
                                {!canResolve ? (
                                  canExplain && (
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
                                      {item.request ? 'Reply' : 'Explain'}
                                    </button>
                                  )
                                ) : (
                                  <button
                                    className="btn btn-ghost"
                                    style={{ padding: '4px 10px', fontSize: 11 }}
                                    title="Ask the submitter to explain this cell and email them"
                                    onClick={() => openAsk(g, item)}
                                  >
                                    {item.request ? 'Ask Again' : 'Request Further Comment'}
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
          })
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

      <Modal
        open={asking !== null}
        title="Request further comment"
        onClose={() => setAsking(null)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setAsking(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={sendAsk}>
              Send Request
            </button>
          </>
        }
      >
        {asking && (
          <>
            <div className="variance-panel" style={{ marginBottom: 18 }}>
              <h4>{asking.group.entity} · {weekLabelShort(asking.group.period)}</h4>
              <div className="row">
                <span>
                  {asking.item.category} · {asking.item.dateLabel}
                </span>
                <span>
                  {asking.item.pct === null
                    ? 'new period'
                    : `${asking.item.pct > 0 ? '+' : ''}${asking.item.pct.toFixed(1)}%`}
                </span>
              </div>
              <div className="row">
                <span>
                  Prior: {asking.item.prior === null ? '—' : `€${fmtK(asking.item.prior)}k`}
                </span>
                <span>Current: €{fmtK(asking.item.current)}k</span>
              </div>
            </div>
            {asking.item.comment && (
              <div className="comment-request-note" style={{ marginBottom: 16 }}>
                <strong>{asking.group.submitter} said:</strong> {asking.item.comment}
              </div>
            )}
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label className="form-label">What do you want explained?</label>
              <textarea
                className="form-textarea"
                placeholder="e.g. This is triple last week's payables — is a one-off settlement included?"
                value={askDraft}
                onChange={(e) => setAskDraft(e.target.value)}
                aria-label="Request message"
              />
            </div>
            <span className="text-muted" style={{ fontSize: 11 }}>
              Sending marks the cell on {asking.group.submitter}’s forecast and opens an Outlook
              draft to them.
            </span>
          </>
        )}
      </Modal>
    </div>
  );
}
