import { Fragment, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { dayContributions } from '../../data/dashboardService';
import { loadSettings } from '../../storage/localStorage';
import { DEFAULT_SETTINGS } from '../settings/defaults';

interface DayBreakdownModalProps {
  open: boolean;
  week: string;
  dayIdx: number;
  dayLabel: string;
  /** Countries the dashboard's selector has in scope; omit for all. */
  onlyEntities?: string[];
  onClose: () => void;
  /** Open a country's forecast from its row. */
  onOpen: (target: { entity: string; templateId: string }) => void;
}

const fmtK = (v: number) => `€${Math.round(v).toLocaleString()}k`;

/**
 * Who is behind one day of the outlook.
 *
 * Countries are ranked by how far they moved the group number versus the
 * prior forecast — largest first — and start collapsed, so the answer to
 * "what caused this spike" is the top row, and the line items behind it are
 * one click away rather than a wall of numbers.
 */
export function DayBreakdownModal({
  open,
  week,
  dayIdx,
  dayLabel,
  onlyEntities,
  onClose,
  onOpen,
}: DayBreakdownModalProps) {
  const rows = useMemo(
    () => dayContributions(week, dayIdx, loadSettings(DEFAULT_SETTINGS), onlyEntities),
    [week, dayIdx, onlyEntities],
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (entity: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(entity)) next.delete(entity);
      else next.add(entity);
      return next;
    });

  const groupNet = rows.reduce((s, r) => s + r.net, 0);
  const groupPrior = rows.reduce((s, r) => s + (r.priorNet ?? 0), 0);

  return (
    <Modal
      open={open}
      title={`${dayLabel} · country breakdown`}
      size="xl"
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="preview-meta">
        <span className="text-dim">
          Net {fmtK(groupNet)} · prior forecast {fmtK(groupPrior)} · sorted by contribution to the
          move
        </span>
        <span className="progress-summary">Click a country for its line items</span>
      </div>

      <div className="panel-body no-pad">
        <table className="breakdown-table">
          <thead>
            <tr>
              <th>Country</th>
              <th className="num">Inflows</th>
              <th className="num">Outflows</th>
              <th className="num">Net (€k)</th>
              <th className="num">Prior (€k)</th>
              <th className="num">Move (€k)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOpen = expanded.has(row.entity);
              const up = row.priorNet !== null && row.net >= row.priorNet;
              return (
                <Fragment key={row.entity}>
                  <tr
                    className="breakdown-row"
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={() => toggle(row.entity)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggle(row.entity);
                      }
                    }}
                  >
                    <td>
                      <span className="section-caret" aria-hidden="true">
                        {isOpen ? '▾' : '▸'}
                      </span>
                      <strong>{row.entity}</strong>
                      <span className="text-muted breakdown-count">{row.region}</span>
                    </td>
                    <td className="num">{Math.round(row.inflows).toLocaleString()}</td>
                    <td className="num">{Math.round(row.outflows).toLocaleString()}</td>
                    <td className="num">{Math.round(row.net).toLocaleString()}</td>
                    <td className="num text-muted">
                      {row.priorNet === null ? '—' : Math.round(row.priorNet).toLocaleString()}
                    </td>
                    <td className="num">
                      {row.priorNet === null ? (
                        <span className="text-muted">new</span>
                      ) : (
                        <span className={`delta ${up ? 'up' : 'down'}`}>
                          {up ? '+' : '−'}
                          {Math.round(row.varianceAbs).toLocaleString()}
                          {row.variancePct === null
                            ? ''
                            : ` · ${row.variancePct > 0 ? '+' : ''}${row.variancePct.toFixed(0)}%`}
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 10px', fontSize: 11 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen({ entity: row.entity, templateId: row.templateId });
                        }}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                  {isOpen &&
                    (row.lines.length === 0 ? (
                      <tr className="breakdown-child" key={`${row.entity}-empty`}>
                        <td colSpan={7} className="text-muted">
                          Nothing forecast for this day.
                        </td>
                      </tr>
                    ) : (
                      row.lines.map((l) => (
                        <tr className="breakdown-child" key={`${row.entity}-${l.label}`}>
                          <td>
                            {l.label}
                            {l.flagged && (
                              <span className="badge-num warn" style={{ marginLeft: 8 }}>
                                flagged
                              </span>
                            )}
                          </td>
                          <td className="num" colSpan={2}>
                            {l.comment ? (
                              <span className="text-dim breakdown-comment">{l.comment}</span>
                            ) : (
                              ''
                            )}
                          </td>
                          <td className="num">{Math.round(l.current).toLocaleString()}</td>
                          <td className="num text-muted">
                            {l.prior === null ? '—' : Math.round(l.prior).toLocaleString()}
                          </td>
                          <td className="num">
                            <span className={`delta ${l.delta >= 0 ? 'up' : 'down'}`}>
                              {l.delta >= 0 ? '+' : '−'}
                              {Math.abs(Math.round(l.delta)).toLocaleString()}
                            </span>
                          </td>
                          <td />
                        </tr>
                      ))
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
