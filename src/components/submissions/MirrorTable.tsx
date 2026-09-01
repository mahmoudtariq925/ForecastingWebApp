import { useMemo } from 'react';
import { countryCode } from '../../data/countryCodes';
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
}

const fmt = (v: number | null): string =>
  v === null ? '—' : Math.round(v).toLocaleString();

/**
 * What the rest of the group says about this entity's week, and what of it
 * this forecast is carrying.
 *
 * Mirroring is pushed — a counterparty types and their figure lands here — so
 * before this there was no way to see what was on OFFER, only what had
 * arrived. A statement this forecast had declined was invisible, and so was
 * the same statement a week ago, whatever the setting.
 *
 * One row per statement: who is settling, when, what they say now, and what
 * they said in the two cycles behind it. Only the current figure is a
 * control — the two history columns are what was submitted at the time, and
 * nothing can be added or removed from a week that is closed.
 */
export function MirrorTable({
  statements,
  dateLabel,
  periodLabels,
  editable,
  onToggle,
}: MirrorTableProps) {
  const carried = useMemo(
    () => statements.filter((s) => s.carried).length,
    [statements],
  );

  if (statements.length === 0) {
    return (
      <div className="mirror-empty text-muted">
        No group company has stated a settlement with this entity for this week.
      </div>
    );
  }

  return (
    <>
      <div className="mirror-lead text-muted">
        {carried} of {statements.length} carried into this forecast
        {editable ? ' · click a current figure to add or remove it' : ''}
      </div>
      <div className="mirror-table-wrap">
        <table className="mirror-table">
          <thead>
            <tr>
              <th scope="col">Country</th>
              <th scope="col">Date</th>
              <th scope="col" className="num">
                {periodLabels.current}
              </th>
              <th scope="col" className="num">
                {periodLabels.prior1}
              </th>
              <th scope="col" className="num">
                {periodLabels.prior2}
              </th>
            </tr>
          </thead>
          <tbody>
            {statements.map((s) => {
              const dates =
                s.days.length === 1
                  ? dateLabel(s.days[0])
                  : `${dateLabel(s.days[0])} +${s.days.length - 1}`;
              return (
                <tr key={`${s.counterparty}:${s.rowId}`} className={s.carried ? 'is-carried' : ''}>
                  <th scope="row">
                    <span className="mirror-code" aria-hidden="true">
                      {countryCode(s.counterparty)}
                    </span>
                    {s.counterparty}
                  </th>
                  <td title={s.days.map(dateLabel).join(', ')}>{dates}</td>
                  <td className="num">
                    {editable ? (
                      <button
                        className={`mirror-take${s.carried ? ' on' : ''}`}
                        aria-pressed={s.carried}
                        title={
                          s.carried
                            ? `Remove ${s.counterparty}'s settlement from this forecast`
                            : `Add ${s.counterparty}'s settlement to this forecast`
                        }
                        onClick={() => onToggle(s.counterparty)}
                      >
                        <span className="mirror-take-mark" aria-hidden="true">
                          {s.carried ? '✓' : '+'}
                        </span>
                        {fmt(s.current)}
                      </button>
                    ) : (
                      <span className={s.carried ? 'mirror-static on' : 'mirror-static'}>
                        {fmt(s.current)}
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
