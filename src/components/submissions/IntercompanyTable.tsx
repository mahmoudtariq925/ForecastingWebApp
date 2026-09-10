import type { CounterpartyStatement } from '../../data/intercompanyService';

interface IntercompanyTableProps {
  statements: CounterpartyStatement[];
  /** "Mon 31/8" for a day index on this forecast's horizon. */
  dateLabel: (day: number) => string;
  /** Short labels for the three columns, e.g. "Wk 36" / "Wk 35" / "Wk 34". */
  periodLabels: { current: string; prior1: string; prior2: string };
  /** Whether the reader may write to this forecast at all. */
  editable: boolean;
  /** Copy a statement's figures into this forecast, on the days it falls. */
  onCopy: (statement: CounterpartyStatement) => void;
}

const fmt = (v: number | null): string => (v === null ? '—' : Math.round(v).toLocaleString());

/**
 * What the rest of the group has already said about this entity's week.
 *
 * A submitter filling in their intercompany section is writing down the same
 * settlements their counterparties have written down from the other side, and
 * this is where they can read them instead of remembering them: one row per
 * statement — who is settling, when, how much, and what they said in the two
 * cycles behind it.
 *
 * It is a REFERENCE, not a feed. Copy puts the figure in the grid on the days
 * it falls, and that is the end of the relationship: the row is this
 * forecast's own from then on, to change or delete like any other, and it does
 * not move again when the counterparty's forecast does.
 *
 * Everything here comes from an APPROVED forecast, so the table is often
 * shorter than the list of countries this entity settles with — and empty
 * early in a cycle, when nobody has been signed off yet. The lead says so, so
 * that a short table is not read as a complete one.
 */
export function IntercompanyTable({
  statements,
  dateLabel,
  periodLabels,
  editable,
  onCopy,
}: IntercompanyTableProps) {
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
        {statements.length === 1
          ? '1 approved settlement names this entity'
          : `${statements.length} approved settlements name this entity`}
        {/* Said on every table, not only the empty one: a country that settles
            with nine others and sees three rows needs to know the other six
            are unapproved rather than absent. */}
        {' · '}
        <span title="A counterparty appears here once their own forecast for the week has been approved">
          approved forecasts only
        </span>
        {editable
          ? ` · copy one in and it becomes your own figure, yours to change`
          : ''}
      </div>
      <div className="mirror-table-wrap">
        <table className="mirror-table">
          <thead>
            <tr>
              <th scope="col">Counterparty</th>
              <th scope="col">Settles</th>
              {/* This week first and nearest the name — it is the one being
                  filled in — with the two cycles behind it after. */}
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
                s.days.length === 1
                  ? dateLabel(s.days[0])
                  : `${dateLabel(s.days[0])} +${s.days.length - 1} more`;
              return (
                <tr key={`${s.counterparty}:${s.rowId}`}>
                  {/* The country's name, and only that: the two-letter code
                      beside it was the same fact twice in one cell. */}
                  <th scope="row">{s.counterparty}</th>
                  <td className="mirror-when" title={s.days.map(dateLabel).join(', ')}>
                    {dates}
                  </td>
                  <td className="num">
                    <span className="ic-figure">{fmt(s.current)}</span>
                    {/* Copying is repeatable on purpose: it writes the same
                        figure on the same days, so a second press after an
                        edit puts the counterparty's number back rather than
                        adding a second row for them. */}
                    {editable && (
                      <span className="ic-copy-wrap">
                        <button
                          className="ic-copy"
                          title={`Copy ${fmt(s.current)} into your forecast on ${s.days
                            .map(dateLabel)
                            .join(', ')} — it becomes your figure, and you can change it`}
                          onClick={() => onCopy(s)}
                        >
                          copy in
                        </button>
                      </span>
                    )}
                  </td>
                  {/* History: what was approved at the time. Nothing here is a
                      control — a closed week is not something to copy from. */}
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
