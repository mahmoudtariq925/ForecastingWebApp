import { useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { StatusPill } from '../common/StatusPill';
import { cycles as seedCycles } from '../../data/mockData';
import { loadCycles, saveCycles } from '../../storage/localStorage';
import type { Cycle } from '../../types';
import type { ModalId } from '../../types/nav';

interface CyclesProps {
  onOpenModal: (id: ModalId) => void;
}

/** Weekly forecast cycles with open/close actions persisted to storage. */
export function Cycles({ onOpenModal }: CyclesProps) {
  const [cycles, setCycles] = useState<Cycle[]>(() => loadCycles(seedCycles));

  // "submitted" here means the cycle is open for entry; "consolidated" = closed.
  const toggleCycle = (id: string) => {
    const next = cycles.map((c) =>
      c.id === id
        ? { ...c, status: c.status === 'submitted' ? ('consolidated' as const) : ('submitted' as const) }
        : c,
    );
    setCycles(next);
    saveCycles(next);
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
                          onClick={() => toggleCycle(c.id)}
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
