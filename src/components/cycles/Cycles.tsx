import { useEffect, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { ErrorView, LoadingView } from '../common/Async';
import { useApi } from '../../hooks/useApi';
import { getCycles, updateCycle } from '../../api/resources';
import type { Cycle } from '../../types';
import type { ModalId } from '../../types/nav';

interface CyclesProps {
  onOpenModal: (id: ModalId) => void;
}

/** Weekly forecast cycles with open/close actions persisted via the API. */
export function Cycles({ onOpenModal }: CyclesProps) {
  const { data, error, loading, reload } = useApi(getCycles);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  useEffect(() => {
    if (data) setCycles(data);
  }, [data]);

  if (error) return <ErrorView crumb="Treasury" title="Forecast Cycles" message={error} onRetry={reload} />;
  if (loading && cycles.length === 0) return <LoadingView crumb="Treasury" title="Forecast Cycles" />;

  // "submitted" here means the cycle is open for entry; "consolidated" = closed.
  const toggleCycle = async (c: Cycle) => {
    const status = c.status === 'submitted' ? ('consolidated' as const) : ('submitted' as const);
    try {
      const updated = await updateCycle(c.id, { status });
      setCycles((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
    } catch (err) {
      alert(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="view active">
      <TopBar
        crumb="Treasury"
        title="Forecast Cycles"
        actions={
          <button className="btn btn-primary" onClick={() => onOpenModal('newCycle')}>
            + New Cycle
          </button>
        }
      />
      <div className="content">
        <div className="panel">
          <div className="panel-body no-pad">
            <table>
              <thead>
                <tr>
                  <th>Cycle ID</th>
                  <th>Period</th>
                  <th>Opened</th>
                  <th>Closes</th>
                  <th>Status</th>
                  <th>Submissions</th>
                  <th className="num">Total (€M)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((c, i) => {
                  const isOpen = c.status === 'submitted';
                  return (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.id}</strong>
                      </td>
                      <td className="text-dim">{c.start} → +30d</td>
                      <td className="text-dim">{i === 0 ? '8h ago' : `${i + 1}w ago`}</td>
                      <td className="text-dim">{c.closes}</td>
                      <td>
                        <StatusPill status={c.status} label={isOpen ? 'open' : c.status} />
                      </td>
                      <td className="text-dim">{c.subs}</td>
                      <td className="num">€{c.total.toFixed(1)}M</td>
                      <td>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={() => toggleCycle(c)}
                        >
                          {isOpen ? 'Close' : 'Open'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
