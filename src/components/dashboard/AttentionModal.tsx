import { Modal } from '../common/Modal';
import type { AttentionRow } from '../../data/dashboardService';

interface AttentionModalProps {
  open: boolean;
  rows: AttentionRow[];
  subtitle: string;
  onClose: () => void;
  /** Open a country's forecast on the cell that needs explaining. */
  onOpen: (row: AttentionRow) => void;
}

const fmtK = (v: number) => `€${Math.round(v).toLocaleString()}k`;

/**
 * Snapshot of every country whose forecast still owes commentary, biggest
 * unexplained move first — the ranking a treasury reviewer actually works
 * down. Replaces the old "Requires Attention" section on the dashboard.
 */
export function AttentionModal({
  open,
  rows,
  subtitle,
  onClose,
  onOpen,
}: AttentionModalProps) {
  const totalOpen = rows.reduce((s, r) => s + r.needCommentary, 0);
  return (
    <Modal
      open={open}
      title="Forecasts requiring commentary"
      size="xl"
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="preview-meta">
        <span className="text-dim">{subtitle}</span>
        <span className="progress-summary">
          {totalOpen} unexplained cell{totalOpen === 1 ? '' : 's'} across {rows.length} countr
          {rows.length === 1 ? 'y' : 'ies'}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">
          <div className="ic">✓</div>
          <p>Every flagged cell has commentary — nothing is blocking the cycle.</p>
        </div>
      ) : (
        <div className="panel-body no-pad">
          <table>
            <thead>
              <tr>
                <th>Country</th>
                <th>Region</th>
                <th className="num">Unexplained</th>
                <th>Largest move</th>
                <th className="num">Size (€k)</th>
                <th className="num">Δ %</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.entity}>
                  <td>
                    <strong>{r.entity}</strong>
                  </td>
                  <td className="text-dim">{r.region}</td>
                  <td className="num">
                    <span className="badge-num warn">{r.needCommentary}</span>
                  </td>
                  <td className="text-dim">{r.worstLabel}</td>
                  <td className="num">{fmtK(r.worstAbs)}</td>
                  <td className="num">
                    {r.worstPct === null ? (
                      // No comparable base to be a percentage of — the size of
                      // the move beside it is the number worth reading.
                      <span className="text-dim" title="No comparable prior value">
                        —
                      </span>
                    ) : (
                      <span className={`delta ${r.worstPct > 0 ? 'up' : 'down'}`}>
                        {r.worstPct > 0 ? '+' : ''}
                        {r.worstPct.toFixed(1)}%
                      </span>
                    )}
                  </td>
                  <td>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 10px', fontSize: 11 }}
                      onClick={() => onOpen(r)}
                    >
                      Open Forecast
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
