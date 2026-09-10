import { useMemo } from 'react';
import type { MirrorStatement } from '../../data/intercompanyService';

interface MirrorTableProps {
  statements: MirrorStatement[];
  /** "Mon 31/8" for a day index on this forecast's horizon. */
  dateLabel: (day: number) => string;
  /** Short labels for the three columns, e.g. "Wk 36" / "Wk 35" / "Wk 34". */
  periodLabels: { current: string; prior1: string; prior2: string };
  /** Whether the reader may change what this forecast carries. */
  editable: boolean;
  /** Carry this counterparty's statement, or stop carrying it. */
  onToggle: (counterparty: string) => void;
  /** Take a statement again at what it says now, replacing the copy held. */
  onRetake: (counterparty: string) => void;
}

const fmt = (v: number | null): string =>
  v === null ? '—' : Math.round(v).toLocaleString();

/**
 * Has the counterparty restated a settlement this forecast is carrying?
 *
 * A carried figure is a copy taken when it was carried, so the two drift
 * apart the moment either side edits. That is not an error — it is the thing
 * the table exists to show, because nothing else on the screen can: the grid
 * holds the copy and says nothing about where it came from.
 *
 * A statement with no approved figure left is NOT this: nobody has restated
 * anything, the settlement has gone back into the counterparty's hands or out
 * of their forecast altogether. `stale` is that case, and the two are counted
 * apart because they are answered differently — one is a figure to take, the
 * other is a forecast to wait on.
 */
const restated = (s: MirrorStatement): boolean =>
  s.carried &&
  s.gone === null &&
  Math.round(s.carriedTotal ?? 0) !== Math.round(s.current ?? 0);

const stale = (s: MirrorStatement): boolean => s.carried && s.gone !== null;

/**
 * What the rest of the group says about this entity's week, and what of it
 * this forecast is carrying.
 *
 * Mirroring is pushed — a counterparty types and their figure lands here — so
 * before this there was no way to see what was on OFFER, only what had
 * arrived. A statement this forecast had declined was invisible, and so was
 * the same statement a week ago, whatever the setting.
 *
 * Everything here comes from an APPROVED forecast, so the table is often
 * shorter than the list of countries this entity settles with — and empty
 * early in a cycle, when nobody has been signed off yet. The lead says so, so
 * that a short table is not read as a complete one.
 *
 * One row per statement: who is settling, when, what they say now, and what
 * they said in the two cycles behind it. Only the current figure is a
 * control — the two history columns are what was approved at the time, and
 * nothing can be added or removed from a week that is closed.
 */
export function MirrorTable({
  statements,
  dateLabel,
  periodLabels,
  editable,
  onToggle,
  onRetake,
}: MirrorTableProps) {
  const carried = useMemo(
    () => statements.filter((s) => s.carried).length,
    [statements],
  );
  /** Carried, and no longer what the counterparty says — see `restated`. */
  const moved = useMemo(
    () => statements.filter((s) => restated(s)).length,
    [statements],
  );
  /** Carried, with no approved figure behind it any more. */
  const dropped = useMemo(() => statements.filter((s) => stale(s)).length, [statements]);

  if (statements.length === 0) {
    return (
      <div className="mirror-empty text-muted">
        No intercompany items are forecast to be paid to or received from other
        countries yet.
      </div>
    );
  }

  return (
    <>
      <div className="mirror-lead text-muted">
        {carried} of {statements.length} carried into this forecast
        {/* Said on every table, not only the empty one: a country that
            settles with nine others and sees three rows needs to know the
            other six are unapproved rather than absent. */}
        {' · '}
        <span title="A counterparty appears here once their own forecast for the week has been approved">
          approved forecasts only
        </span>
        {editable
          ? ` · click a ${periodLabels.current} figure to add that settlement to your grid, or again to take it out`
          : ''}
        {/* Carrying copies a figure; it does not follow it. Where the two have
            parted company the row says so and offers the new one. */}
        {moved > 0 ? (
          <>
            {' · '}
            <strong className="mirror-moved-note">
              {moved === 1
                ? '1 carried settlement has been restated since you took it'
                : `${moved} carried settlements have been restated since you took them`}
            </strong>
          </>
        ) : (
          ''
        )}
        {dropped > 0 ? (
          <>
            {' · '}
            <strong className="mirror-moved-note">
              {dropped === 1
                ? '1 no longer has an approved figure behind it'
                : `${dropped} no longer have an approved figure behind them`}
            </strong>
          </>
        ) : (
          ''
        )}
      </div>
      <div className="mirror-table-wrap">
        <table className="mirror-table">
          <thead>
            <tr>
              <th scope="col">Counterparty</th>
              <th scope="col">Settles</th>
              {/* This week first and nearest the name — it is the one that can
                  still be acted on — with the two cycles behind it after. */}
              <th scope="col" className="num col-current">
                {periodLabels.current}
              </th>
              <th scope="col" className="num col-hist">
                {periodLabels.prior1}
              </th>
              <th scope="col" className="num col-hist">
                {periodLabels.prior2}
              </th>
            </tr>
          </thead>
          <tbody>
            {statements.map((s) => {
              const dates =
                s.days.length === 0
                  ? '—'
                  : s.days.length === 1
                    ? dateLabel(s.days[0])
                    : `${dateLabel(s.days[0])} +${s.days.length - 1} more`;
              /**
               * The figure on the control is what this forecast HOLDS once it
               * is carrying one, and what the counterparty offers before that.
               * Showing their current figure on a carried row would be a
               * number that is not in the grid underneath it.
               */
              const shown = s.carried ? s.carriedTotal : s.current;
              return (
                <tr key={`${s.counterparty}:${s.rowId}`} className={s.carried ? 'is-carried' : ''}>
                  {/* The country's name, and only that: the two-letter code
                      beside it was the same fact twice in one cell. */}
                  <th scope="row">{s.counterparty}</th>
                  <td className="mirror-when" title={s.days.map(dateLabel).join(', ')}>
                    {dates}
                  </td>
                  <td className="num">
                    {editable ? (
                      <button
                        className={`mirror-take${s.carried ? ' on' : ''}`}
                        aria-pressed={s.carried}
                        title={
                          s.carried
                            ? `Remove ${s.counterparty}'s settlement from this forecast`
                            : `Add ${s.counterparty}'s settlement to this forecast — the figure is copied in as it stands now`
                        }
                        onClick={() => onToggle(s.counterparty)}
                      >
                        <span className="mirror-take-mark" aria-hidden="true">
                          {s.carried ? '✓' : '+'}
                        </span>
                        {/* The button says which of the two things it does;
                            without it the only difference between carrying a
                            statement and not was the colour of a figure. */}
                        <span className="mirror-take-word">
                          {s.carried ? 'Carried' : 'Add'}
                        </span>
                        {fmt(shown)}
                      </button>
                    ) : (
                      <span className={s.carried ? 'mirror-static on' : 'mirror-static'}>
                        {fmt(shown)}
                      </span>
                    )}
                    {/* What the counterparty says NOW, where that is no longer
                        what was taken. The copy stands until somebody says
                        otherwise — this is where they say it. */}
                    {(restated(s) || stale(s)) && (
                      <span className="mirror-moved">
                        {/* A settlement taken out is one to stop carrying; a
                            forecast reopened for changes is one to wait on.
                            Both leave the copy standing, so the row has to say
                            which of the two it is. */}
                        {s.gone === 'withdrawn' ? (
                          <span className="mirror-moved-word">no longer stated</span>
                        ) : s.gone === 'unapproved' ? (
                          <span
                            className="mirror-moved-word"
                            title={`${s.counterparty}'s forecast is back with them and no longer approved — the figure carried here is the one that was signed off`}
                          >
                            no longer approved
                          </span>
                        ) : editable ? (
                          <button
                            className="mirror-retake"
                            title={`${s.counterparty} now states ${fmt(s.current)} — replace the figure this forecast carries`}
                            onClick={() => onRetake(s.counterparty)}
                          >
                            now {fmt(s.current)} · take
                          </button>
                        ) : (
                          <span className="mirror-moved-word">now {fmt(s.current)}</span>
                        )}
                      </span>
                    )}
                  </td>
                  {/* History: what was submitted at the time. Nothing here is
                      a control — a closed week is not something to add to. */}
                  <td className="num hist">{fmt(s.prior1)}</td>
                  <td className="num hist">{fmt(s.prior2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
