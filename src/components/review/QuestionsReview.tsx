import { useMemo, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { RequestCommentaryModal } from '../submissions/RequestCommentaryModal';
import { useDataVersion } from '../../data/useDataVersion';
import { activeWeekKey } from '../../data/cycleService';
import { weekLabel, weekLabelShort } from '../../data/periods';
import {
  collectQuestionGroups,
  questionTotals,
  waitedLabel,
  type QuestionGroup,
  type QuestionItem,
  type QuestionState,
} from '../../data/questionService';
import { requesterLabel, setFlagResolved } from '../../data/submissionService';
import { loadTemplates } from '../../storage/localStorage';
import type { SubmissionTarget } from '../submissions/Submission';

interface QuestionsReviewProps {
  onOpenSubmission?: (target: SubmissionTarget) => void;
  /** Restrict to these entities (approver scoping); undefined = the group. */
  scopeEntities?: string[];
}

const ALL = 'all';
const PAGE_SIZE = 12;

/** The queue's shape, chosen by what the reader is doing. */
type StateFilter = 'open' | 'awaiting' | 'answered' | 'closed' | 'all';

const STATE_OPTIONS: { value: StateFilter; label: string }[] = [
  { value: 'open', label: 'Open questions' },
  { value: 'awaiting', label: 'Awaiting a reply' },
  { value: 'answered', label: 'Answered — to read' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'Every question' },
];

const STATE_MATCH: Record<StateFilter, (s: QuestionState) => boolean> = {
  open: (s) => s !== 'closed',
  awaiting: (s) => s === 'awaiting',
  answered: (s) => s === 'answered',
  closed: (s) => s === 'closed',
  all: () => true,
};

const fmtK = (v: number) => `€${Math.round(v).toLocaleString()}k`;

/** The newest reply on a forecast that its asker has not closed off yet. */
function latestAnswer(group: QuestionGroup): QuestionItem | undefined {
  return group.items
    .filter((i) => i.state === 'answered' && i.answer)
    .sort((a, b) => (b.answeredAt ?? '').localeCompare(a.answeredAt ?? ''))[0];
}

function StatePill({ state }: { state: QuestionState }) {
  if (state === 'awaiting') return <StatusPill status="rejected" label="awaiting reply" />;
  if (state === 'answered') return <StatusPill status="submitted" label="answered" />;
  return <StatusPill status="approved" label="closed" />;
}

/** A headline number. Clicking it filters the queue to what it counts. */
function Stat({
  label,
  value,
  sub,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'ok' | 'warn' | 'plain';
  active?: boolean;
  onClick?: () => void;
}) {
  const className = `kpi-card${onClick ? ' kpi-clickable' : ''}${
    tone === 'plain' ? '' : ` tone-${tone}`
  }${active ? ' kpi-active' : ''}`;
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub text-dim">{sub}</div>
    </>
  );
  return onClick ? (
    <button className={className} onClick={onClick} aria-pressed={active}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * Treasury's questions queue.
 *
 * This screen used to list every comment on every forecast — the submitters'
 * own variance commentary, hundreds of rows of it, most of which nobody was
 * waiting on. What treasury actually has to keep on top of is the QUESTIONS
 * it and the approvers have asked: who has not replied, what came back, and
 * what can be closed.
 *
 * Built for a queue that gets long: counts first, one row per FORECAST,
 * everything collapsed until it is opened, ordered by who has been waiting
 * longest. The commentary itself is untouched — it is written and read on the
 * forecast, where the numbers it explains are.
 */
export function QuestionsReview({ onOpenSubmission, scopeEntities }: QuestionsReviewProps) {
  const version = useDataVersion();
  const groups = useMemo(() => {
    void version; // storage changed → recollect
    const all = collectQuestionGroups(loadTemplates());
    return scopeEntities ? all.filter((g) => scopeEntities.includes(g.entity)) : all;
  }, [version, scopeEntities]);

  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('open');
  const [askedBy, setAskedBy] = useState(ALL);
  const [regionFilter, setRegionFilter] = useState(ALL);
  /** Opens on the cycle in progress; older weeks are one dropdown away. */
  const [periodFilter, setPeriodFilter] = useState(() => activeWeekKey());
  const [page, setPage] = useState(0);
  /** Forecasts opened by the reader. Everything starts closed. */
  const [opened, setOpened] = useState<Set<string>>(new Set());
  /** The question being asked again, if any. */
  const [asking, setAsking] = useState<QuestionItem | null>(null);

  const options = useMemo(() => {
    const uniq = (v: string[]) => [...new Set(v)].sort();
    return {
      regions: uniq(groups.map((g) => g.region)),
      periods: [...new Set(groups.map((g) => g.period))].sort().reverse(),
    };
  }, [groups]);

  /** How many questions each side of the conversation has open right now. */
  const counts = useMemo(() => {
    const items = groups.flatMap((g) => g.items).filter((i) => i.state !== 'closed');
    return {
      treasury: items.filter((i) => i.role === 'treasury').length,
      approver: items.filter((i) => i.role === 'approver').length,
    };
  }, [groups]);

  const resetPage = () => setPage(0);

  /** Groups carrying only the questions that pass the filters. */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out: QuestionGroup[] = [];
    for (const g of groups) {
      if (regionFilter !== ALL && g.region !== regionFilter) continue;
      if (periodFilter !== ALL && g.period !== periodFilter) continue;
      const groupText = `${g.entity} ${g.submitter} ${g.templateName} ${weekLabel(g.period)}`
        .toLowerCase();
      const items = g.items.filter((i) => {
        if (!STATE_MATCH[stateFilter](i.state)) return false;
        if (askedBy !== ALL && i.role !== askedBy) return false;
        if (!q) return true;
        return (
          groupText.includes(q) ||
          i.category.toLowerCase().includes(q) ||
          i.message.toLowerCase().includes(q) ||
          i.answer.toLowerCase().includes(q) ||
          i.from.toLowerCase().includes(q)
        );
      });
      if (items.length === 0) continue;
      out.push({
        ...g,
        items,
        awaiting: items.filter((i) => i.state === 'awaiting').length,
        answered: items.filter((i) => i.state === 'answered').length,
        closed: items.filter((i) => i.state === 'closed').length,
        oldestAwaiting: items.find((i) => i.state === 'awaiting')?.requestedAt ?? null,
      });
    }
    return out;
  }, [groups, search, stateFilter, askedBy, regionFilter, periodFilter]);

  const totals = useMemo(() => questionTotals(groups), [groups]);
  const shown = filtered.reduce((s, g) => s + g.items.length, 0);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageGroups = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const toggle = (id: string) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOpen = pageGroups.length > 0 && pageGroups.every((g) => opened.has(g.id));
  const toggleAll = () =>
    setOpened(allOpen ? new Set() : new Set(pageGroups.map((g) => g.id)));

  /** Close a question off (or put it back) — the asker's own bookkeeping. */
  const setClosed = (item: QuestionItem, closed: boolean) => {
    setFlagResolved(item.period, item.entity, item.templateId, item.cellKey, closed);
  };

  const openForecast = (item: QuestionItem) =>
    onOpenSubmission?.({
      entity: item.entity,
      week: item.period,
      templateId: item.templateId,
      focusCell: item.cellKey,
    });

  /** A stat box doubles as the filter for what it counts. */
  const pick = (next: StateFilter) => () => {
    setStateFilter((prev) => (prev === next ? 'open' : next));
    resetPage();
  };

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
                : 'Nobody is waiting on a submitter'
            }
            tone={totals.awaiting === 0 ? 'ok' : 'warn'}
            active={stateFilter === 'awaiting'}
            onClick={pick('awaiting')}
          />
          <Stat
            label="Answered — to read"
            value={String(totals.answered)}
            sub={totals.answered === 0 ? 'Nothing new came back' : 'Replies you have not closed'}
            tone={totals.answered === 0 ? 'ok' : 'warn'}
            active={stateFilter === 'answered'}
            onClick={pick('answered')}
          />
          <Stat
            label="Closed"
            value={String(totals.closed)}
            sub="Answered and marked reviewed"
            tone="plain"
            active={stateFilter === 'closed'}
            onClick={pick('closed')}
          />
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
                onChange={(e) => {
                  setSearch(e.target.value);
                  resetPage();
                }}
                aria-label="Search questions"
              />
              <select
                className="form-select"
                style={{ width: 'auto' }}
                value={stateFilter}
                onChange={(e) => {
                  setStateFilter(e.target.value as StateFilter);
                  resetPage();
                }}
                aria-label="Filter by state"
              >
                {STATE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {/* Treasury's questions and the approvers' sit in one queue —
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
                    onClick={() => {
                      setAskedBy(value);
                      resetPage();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <select
                className="form-select"
                style={{ width: 'auto' }}
                value={regionFilter}
                onChange={(e) => {
                  setRegionFilter(e.target.value);
                  resetPage();
                }}
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
            </div>
            <div className="row-flex">
              <span className="grid-info">
                <strong>{shown}</strong> question{shown === 1 ? '' : 's'} across{' '}
                <strong>{filtered.length}</strong> forecast{filtered.length === 1 ? '' : 's'}
              </span>
              {pageGroups.length > 0 && (
                <button className="btn btn-ghost" onClick={toggleAll}>
                  {allOpen ? 'Collapse all' : 'Expand all'}
                </button>
              )}
            </div>
          </div>
        </div>

        {pageGroups.length === 0 ? (
          <div className="panel">
            <div className="empty-state">
              <div className="ic">✓</div>
              <p>
                {groups.length === 0
                  ? 'No questions have been asked yet. Open a forecast and click a cell to ask its submitter about it.'
                  : 'Nothing matches these filters — try "Every question" or clear the search.'}
              </p>
            </div>
          </div>
        ) : (
          pageGroups.map((g) => {
            const isOpen = opened.has(g.id);
            return (
              <div
                className={`panel question-group${g.awaiting > 0 ? ' question-waiting' : ''}`}
                key={g.id}
              >
                <button
                  className="question-head"
                  aria-expanded={isOpen}
                  onClick={() => toggle(g.id)}
                >
                  <span className="question-head-main">
                    <span className="review-caret" aria-hidden="true">
                      {isOpen ? '▾' : '▸'}
                    </span>
                    <strong className="question-entity">{g.entity}</strong>
                    <span className="text-dim">{weekLabelShort(g.period)}</span>
                    <StatusPill status={g.forecastStatus} />
                    <span className="text-muted question-submitter">{g.submitter}</span>
                    <span className="question-counts">
                      {g.awaiting > 0 && (
                        <span className="badge-num warn">{g.awaiting} awaiting reply</span>
                      )}
                      {g.answered > 0 && <span className="badge-num ok">{g.answered} answered</span>}
                      {g.closed > 0 && <span className="badge-num">{g.closed} closed</span>}
                      {g.oldestAwaiting && (
                        <span
                          className="question-age"
                          title="How long the oldest reply has been outstanding"
                        >
                          waiting {waitedLabel(g.oldestAwaiting)}
                        </span>
                      )}
                    </span>
                  </span>
                  {/* The reply itself, on the closed row. An answer that has
                      come back is the thing worth reading, and hiding it
                      behind a click made a queue of them look like a queue of
                      questions with nothing in it. */}
                  {!isOpen && latestAnswer(g) && (
                    <span className="question-head-answer">
                      <strong>{g.submitter} answered:</strong> {latestAnswer(g)?.answer}
                    </span>
                  )}
                </button>
                {isOpen && (
                  <div className="question-list">
                    {g.items.map((item) => (
                      <div className={`question-row state-${item.state}`} key={item.id}>
                        <div className="question-row-head">
                          <StatePill state={item.state} />
                          <strong>{item.category}</strong>
                          <span className="text-dim">{item.dateLabel}</span>
                          <span className="question-figures">
                            {fmtK(item.current)}
                            {item.prior !== null && (
                              <>
                                {' '}
                                vs {fmtK(item.prior)}
                                {item.pct !== null && (
                                  <span className={`delta ${item.pct > 0 ? 'up' : 'down'}`}>
                                    {item.pct > 0 ? '+' : ''}
                                    {item.pct.toFixed(1)}%
                                  </span>
                                )}
                              </>
                            )}
                          </span>
                          <span className="question-row-actions">
                            {onOpenSubmission && (
                              <button
                                className="btn btn-ghost"
                                style={{ padding: '4px 10px', fontSize: 11 }}
                                title="Open the forecast on this cell"
                                onClick={() => openForecast(item)}
                              >
                                Open Forecast
                              </button>
                            )}
                            <button
                              className="btn btn-ghost"
                              style={{ padding: '4px 10px', fontSize: 11 }}
                              title="Ask about this cell again"
                              onClick={() => setAsking(item)}
                            >
                              Ask Again
                            </button>
                            {item.state === 'answered' && (
                              <button
                                className="btn btn-primary"
                                style={{ padding: '4px 10px', fontSize: 11 }}
                                title="Close this question — the answer is enough"
                                onClick={() => setClosed(item, true)}
                              >
                                Mark Reviewed
                              </button>
                            )}
                            {item.state === 'closed' && (
                              <button
                                className="btn btn-ghost"
                                style={{ padding: '4px 10px', fontSize: 11 }}
                                onClick={() => setClosed(item, false)}
                              >
                                Reopen
                              </button>
                            )}
                          </span>
                        </div>
                        <div className="question-ask">
                          <strong>
                            {item.from} ({requesterLabel(item.role)}) asked
                          </strong>
                          <span className="text-muted"> · {waitedLabel(item.requestedAt)} ago</span>
                          : {item.message}
                        </div>
                        {item.answer ? (
                          <div className="question-answer">
                            <strong>{g.submitter} answered:</strong> {item.answer}
                          </div>
                        ) : (
                          <div className="question-answer pending">
                            No reply yet — {g.submitter} has this on their checklist.
                          </div>
                        )}
                      </div>
                    ))}
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

      {asking && (
        <RequestCommentaryModal
          target={{
            entity: asking.entity,
            week: asking.period,
            templateId: asking.templateId,
            cellKey: asking.cellKey,
            label: asking.category,
            periodLabel: asking.dateLabel,
            current: asking.current,
            prior: asking.prior,
            comment: asking.answer,
          }}
          context={`${asking.entity} · ${weekLabelShort(asking.period)}`}
          existing={asking.state === 'awaiting' ? { ...asking, fromRole: asking.role } : null}
          flagged
          onClose={() => setAsking(null)}
        />
      )}
    </div>
  );
}
