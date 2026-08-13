import { useMemo, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { Modal } from '../common/Modal';
import { QuestionThread, ThreadComposer } from './QuestionThread';
import { useDataVersion } from '../../data/useDataVersion';
import { activeWeekKey, isCycleOpen } from '../../data/cycleService';
import { weekLabel, weekLabelShort } from '../../data/periods';
import {
  collectQuestionGroups,
  flattenQuestions,
  questionTotals,
  sortForColumn,
  waitedLabel,
  type QuestionItem,
  type QuestionState,
} from '../../data/questionService';
import {
  postThreadMessage,
  requesterLabel,
  setFlagResolved,
} from '../../data/submissionService';
import { currentUser, permissionsFor } from '../../data/session';
import { loadTemplates } from '../../storage/localStorage';
import type { ThreadRole } from '../../types';
import type { SubmissionTarget } from '../submissions/Submission';

interface QuestionsReviewProps {
  onOpenSubmission?: (target: SubmissionTarget) => void;
  /** Restrict to these entities (role scoping); undefined = the group. */
  scopeEntities?: string[];
}

const ALL = 'all';

/** The board's columns, left to right: what is owed, what came back, what is done. */
const COLUMNS: { state: QuestionState; title: string; blurb: string }[] = [
  { state: 'awaiting', title: 'Awaiting reply', blurb: 'Someone is waiting on an answer' },
  { state: 'answered', title: 'Answered', blurb: 'Replies nobody has closed off yet' },
  { state: 'closed', title: 'Closed', blurb: 'Answered and marked reviewed' },
];

const fmtK = (v: number) => `€${Math.round(v).toLocaleString()}k`;

/** Which side of the conversation the signed-in user writes from. */
function viewerRoleOf(): ThreadRole | null {
  const p = permissionsFor(currentUser());
  if (p.canViewTreasuryDashboard) return 'treasury';
  if (p.canApproveForecasts) return 'approver';
  if (p.canSubmitForecasts) return 'submitter';
  // A viewer reads the conversation and takes no part in it.
  return null;
}

/** A headline number. */
function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'ok' | 'warn' | 'plain';
}) {
  return (
    <div className={`kpi-card${tone === 'plain' ? '' : ` tone-${tone}`}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub text-dim">{sub}</div>
    </div>
  );
}

/** One conversation, as a card on the board. */
function QuestionCard({
  item,
  viewerRole,
  onOpen,
}: {
  item: QuestionItem;
  viewerRole: ThreadRole | null;
  onOpen: () => void;
}) {
  const replies = item.thread.length - 1;
  return (
    <article
      className={`question-card state-${item.state}`}
      role="button"
      tabIndex={0}
      aria-label={`Open the conversation about ${item.category} on ${item.entity}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <header className="question-card-head">
        <strong>{item.entity}</strong>
        <span className="text-dim">{weekLabelShort(item.period)}</span>
        <StatusPill status={item.forecastStatus} />
      </header>
      <div className="question-card-cell">
        <strong>{item.category}</strong>
        <span className="text-dim">{item.dateLabel}</span>
      </div>
      <div className="question-card-figures">
        <span>{fmtK(item.current)}</span>
        {item.prior !== null && (
          <>
            <span className="text-muted">vs {fmtK(item.prior)}</span>
            {item.pct !== null && (
              <span className={`delta ${item.pct > 0 ? 'up' : 'down'}`}>
                {item.pct > 0 ? '+' : ''}
                {item.pct.toFixed(1)}%
              </span>
            )}
          </>
        )}
      </div>
      <QuestionThread messages={item.thread} viewerRole={viewerRole} compact />
      <footer className="question-card-foot">
        {/* WHO ASKED, and in what capacity. The card used to name the person
            who owes the answer, which read as the author of the question
            sitting above it — and an approver's question and treasury's are
            two different things to a reader deciding what to do next. */}
        <span className="question-card-asker" title={`Asked by ${item.from}`}>
          {item.from}
          <span className={`role-tag ${item.role}`}>{requesterLabel(item.role)}</span>
        </span>
        <span className="text-muted">
          {replies > 0 ? `${replies} repl${replies === 1 ? 'y' : 'ies'} · ` : ''}
          {item.state === 'awaiting'
            ? `waiting ${waitedLabel(item.requestedAt)}`
            : `${waitedLabel(item.lastAt)} ago`}
        </span>
      </footer>
    </article>
  );
}

/**
 * The questions board — every role's review screen.
 *
 * Treasury, approvers and submitters were all working the same conversation
 * from different screens: treasury had a queue of questions, everyone else a
 * list of every comment ever written on a forecast. They are one board now,
 * scoped to whatever the reader is responsible for, laid out by the only thing
 * that decides what to do next: whether a question is waiting on a reply, has
 * one to read, or is finished with.
 *
 * The commentary itself is untouched — it is written and read on the forecast,
 * where the numbers it explains are.
 */
export function QuestionsReview({ onOpenSubmission, scopeEntities }: QuestionsReviewProps) {
  const version = useDataVersion();
  const viewerRole = useMemo(() => {
    void version;
    return viewerRoleOf();
  }, [version]);

  const groups = useMemo(() => {
    void version; // storage changed → recollect
    const all = collectQuestionGroups(loadTemplates());
    return scopeEntities ? all.filter((g) => scopeEntities.includes(g.entity)) : all;
  }, [version, scopeEntities]);
  const items = useMemo(() => flattenQuestions(groups), [groups]);
  const totals = useMemo(() => questionTotals(groups), [groups]);

  const [search, setSearch] = useState('');
  const [askedBy, setAskedBy] = useState(ALL);
  const [regionFilter, setRegionFilter] = useState(ALL);
  /** Opens on the cycle in progress; older weeks are one dropdown away. */
  const [periodFilter, setPeriodFilter] = useState(() => activeWeekKey());
  /** The conversation being read, if any. */
  const [openId, setOpenId] = useState<string | null>(null);

  const options = useMemo(() => {
    const uniq = (v: string[]) => [...new Set(v)].sort();
    return {
      regions: uniq(items.map((i) => i.region)),
      periods: [...new Set(items.map((i) => i.period))].sort().reverse(),
    };
  }, [items]);

  /** How many questions each side of the conversation has open right now. */
  const counts = useMemo(() => {
    const open = items.filter((i) => i.state !== 'closed');
    return {
      treasury: open.filter((i) => i.role === 'treasury').length,
      approver: open.filter((i) => i.role === 'approver').length,
    };
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (regionFilter !== ALL && i.region !== regionFilter) return false;
      if (periodFilter !== ALL && i.period !== periodFilter) return false;
      if (askedBy !== ALL && i.role !== askedBy) return false;
      if (!q) return true;
      return (
        i.entity.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q) ||
        i.owner.toLowerCase().includes(q) ||
        i.from.toLowerCase().includes(q) ||
        weekLabel(i.period).toLowerCase().includes(q) ||
        i.thread.some((m) => m.text.toLowerCase().includes(q))
      );
    });
  }, [items, search, askedBy, regionFilter, periodFilter]);

  /**
   * Each column's cards, and — for a reader who covers the whole group —
   * those cards grouped by region.
   *
   * Treasury opens this board on eleven countries at once, which is a column
   * of forty cards to scroll before knowing whether DACH is clear. Regions
   * turn that into a handful of closed bands with counts on them. An approver
   * or submitter has a country or two, so their cards stay where they are.
   */
  const columns = useMemo(
    () =>
      COLUMNS.map((c) => {
        const cards = sortForColumn(
          filtered.filter((i) => i.state === c.state),
          c.state,
        );
        const byRegion = new Map<string, QuestionItem[]>();
        for (const item of cards) {
          const list = byRegion.get(item.region);
          if (list) list.push(item);
          else byRegion.set(item.region, [item]);
        }
        return {
          ...c,
          items: cards,
          regions: [...byRegion.entries()]
            .map(([name, list]) => ({ name, items: list }))
            // Busiest region first: it is the one with work in it.
            .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name)),
        };
      }),
    [filtered],
  );

  /** A reader who covers the whole group gets the region bands. */
  const byRegion = scopeEntities === undefined;
  /** Columns fold away; they open with the board. */
  const [closedCols, setClosedCols] = useState<Set<QuestionState>>(new Set());
  /** Region bands are the opposite: closed until asked for. */
  const [openRegions, setOpenRegions] = useState<Set<string>>(new Set());
  const toggleCol = (state: QuestionState) =>
    setClosedCols((prev) => {
      const next = new Set(prev);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      return next;
    });
  const toggleRegion = (key: string) =>
    setOpenRegions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  /** A search is a request to SEE the matches, not to go hunting for them. */
  const searching = search.trim() !== '';

  const openItem = openId ? (items.find((i) => i.id === openId) ?? null) : null;

  /** Close a question off (or put it back) — the asker's own bookkeeping. */
  const setClosed = (item: QuestionItem, closed: boolean) =>
    setFlagResolved(item.period, item.entity, item.templateId, item.cellKey, closed);

  const reply = (item: QuestionItem, text: string) => {
    if (!viewerRole) return;
    postThreadMessage(item.period, item.entity, item.templateId, item.cellKey, {
      from: currentUser().name,
      role: viewerRole,
      text,
      at: new Date().toISOString(),
    });
  };

  const openForecast = (item: QuestionItem) =>
    onOpenSubmission?.({
      entity: item.entity,
      week: item.period,
      templateId: item.templateId,
      focusCell: item.cellKey,
    });

  /** Whoever is not the submitter is the one who can call a question done. */
  const isAsker = viewerRole === 'treasury' || viewerRole === 'approver';

  return (
    <div className="view active">
      <TopBar
        crumb="Workspace"
        title="Questions"
        actions={
          <span className="tag" style={{ letterSpacing: '0.12em' }}>
            {totals.awaiting} awaiting a reply
            {totals.oldestAwaiting ? ` · longest ${waitedLabel(totals.oldestAwaiting)}` : ''}
          </span>
        }
      />
      <div className="content content-compact">
        <div className="kpi-grid">
          <Stat
            label="Awaiting a reply"
            value={String(totals.awaiting)}
            sub={
              totals.oldestAwaiting
                ? `Longest waiting ${waitedLabel(totals.oldestAwaiting)}`
                : 'Nobody is waiting on an answer'
            }
            tone={totals.awaiting === 0 ? 'ok' : 'warn'}
          />
          <Stat
            label="Answered"
            value={String(totals.answered)}
            sub={totals.answered === 0 ? 'Nothing new came back' : 'Replies not yet closed off'}
            tone={totals.answered === 0 ? 'ok' : 'warn'}
          />
          <Stat label="Closed" value={String(totals.closed)} sub="Answered and reviewed" tone="plain" />
          <Stat
            label="Forecasts in play"
            value={String(totals.forecasts)}
            sub="Have been asked at least one question"
            tone="plain"
          />
        </div>

        <div className="panel">
          <div className="grid-toolbar" data-tour="review-filters">
            <div className="grid-toolbar-left">
              <input
                className="form-input"
                style={{ width: 240 }}
                placeholder="Search country, line item, question…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search questions"
              />
              {/* Treasury's questions and the approvers' sit on one board —
                  they are the same conversation with the same submitter — and
                  this is how you look at either side of it on its own. */}
              <div className="seg-toggle" role="group" aria-label="Filter by who asked">
                {(
                  [
                    [ALL, 'Both'],
                    ['treasury', `Treasury${counts.treasury ? ` · ${counts.treasury}` : ''}`],
                    ['approver', `Approvers${counts.approver ? ` · ${counts.approver}` : ''}`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={askedBy === value ? 'active' : ''}
                    aria-pressed={askedBy === value}
                    onClick={() => setAskedBy(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <select
                className="form-select"
                style={{ width: 'auto' }}
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                aria-label="Filter by region"
              >
                <option value={ALL}>All regions</option>
                {options.regions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <select
                className="form-select"
                style={{ width: 'auto' }}
                value={periodFilter}
                onChange={(e) => setPeriodFilter(e.target.value)}
                aria-label="Filter by forecast period"
              >
                <option value={ALL}>All periods</option>
                {options.periods.map((p) => (
                  <option key={p} value={p}>
                    {weekLabel(p)}
                  </option>
                ))}
              </select>
            </div>
            <span className="grid-info">
              <strong>{filtered.length}</strong> question{filtered.length === 1 ? '' : 's'} on this
              board
            </span>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="panel">
            <div className="empty-state">
              <div className="ic">✓</div>
              <p>
                No questions have been asked yet. Open a forecast and click a cell to ask its
                submitter about it.
              </p>
            </div>
          </div>
        ) : (
          <div className="question-board">
            {columns.map((col) => {
              const open = !closedCols.has(col.state);
              const card = (item: QuestionItem) => (
                <QuestionCard
                  key={item.id}
                  item={item}
                  viewerRole={viewerRole}
                  onOpen={() => setOpenId(item.id)}
                />
              );
              return (
                <section
                  className={`question-col col-${col.state}${open ? '' : ' col-closed'}`}
                  key={col.state}
                >
                  <button
                    className="question-col-head"
                    aria-expanded={open}
                    onClick={() => toggleCol(col.state)}
                  >
                    <span className="section-caret" aria-hidden="true">
                      {open ? '▾' : '▸'}
                    </span>
                    <strong>{col.title}</strong>
                    <span className="badge-num">{col.items.length}</span>
                    <span className="question-col-blurb text-muted">{col.blurb}</span>
                  </button>
                  {open && (
                    <div className="question-col-body">
                      {col.items.length === 0 ? (
                        <p className="question-col-empty text-muted">Nothing here.</p>
                      ) : byRegion ? (
                        col.regions.map((region) => {
                          const key = `${col.state}:${region.name}`;
                          const regionOpen = searching || openRegions.has(key);
                          return (
                            <div className="question-region" key={key}>
                              <button
                                className="question-region-head"
                                aria-expanded={regionOpen}
                                onClick={() => toggleRegion(key)}
                              >
                                <span className="section-caret" aria-hidden="true">
                                  {regionOpen ? '▾' : '▸'}
                                </span>
                                <strong>{region.name}</strong>
                                <span className="badge-num">{region.items.length}</span>
                                {!regionOpen && (
                                  <span className="question-region-who text-muted">
                                    {[...new Set(region.items.map((i) => i.entity))].join(', ')}
                                  </span>
                                )}
                              </button>
                              {regionOpen && (
                                <div className="question-region-body">
                                  {region.items.map(card)}
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        col.items.map(card)
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {openItem && (
        <Modal
          open
          size="wide"
          title={`${openItem.category} · ${openItem.dateLabel}`}
          onClose={() => setOpenId(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setOpenId(null)}>
                Close
              </button>
              {onOpenSubmission && (
                <button
                  className="btn btn-ghost"
                  title="Open the forecast on this cell"
                  onClick={() => {
                    setOpenId(null);
                    openForecast(openItem);
                  }}
                >
                  Open Forecast
                </button>
              )}
              {isAsker && openItem.state === 'answered' && (
                <button
                  className="btn btn-primary"
                  title="Close this question — the answer is enough"
                  onClick={() => setClosed(openItem, true)}
                >
                  Mark Reviewed
                </button>
              )}
              {isAsker && openItem.state === 'closed' && (
                <button className="btn btn-ghost" onClick={() => setClosed(openItem, false)}>
                  Reopen
                </button>
              )}
            </>
          }
        >
          <div className="variance-panel" style={{ marginBottom: 16 }}>
            <h4>
              {openItem.entity} · {weekLabel(openItem.period)}
            </h4>
            <div className="row">
              <span>
                {openItem.templateName} · asked by {openItem.from} (
                {requesterLabel(openItem.role)})
              </span>
              <span>
                {openItem.pct === null
                  ? 'no comparable prior'
                  : `${openItem.pct > 0 ? '+' : ''}${openItem.pct.toFixed(1)}%`}
              </span>
            </div>
            <div className="row">
              <span>Prior: {openItem.prior === null ? '—' : fmtK(openItem.prior)}</span>
              <span>Current: {fmtK(openItem.current)}</span>
            </div>
          </div>
          <QuestionThread messages={openItem.thread} viewerRole={viewerRole} />
          {viewerRole ? (
            <ThreadComposer
              role={viewerRole}
              hint={
                viewerRole === 'submitter' && isCycleOpen(openItem.period)
                  ? 'Your reply is the commentary on this cell. If the figure itself is wrong, open the forecast and correct it — that sends it round for approval again.'
                  : undefined
              }
              onSend={(text) => reply(openItem, text)}
            />
          ) : (
            <p className="text-muted" style={{ fontSize: 12, marginTop: 12 }}>
              You are reading this conversation — the submitter and whoever asked can reply to it.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
