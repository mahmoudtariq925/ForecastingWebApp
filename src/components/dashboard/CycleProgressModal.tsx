import { useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { StatusPill } from '../common/StatusPill';
import type { RegionProgress } from '../../data/dashboardService';
import { chasedLabel } from '../../data/cycleService';
import { stateRowClass } from '../../data/submissionService';
import type { Entity } from '../../types';

interface CycleProgressModalProps {
  open: boolean;
  title: string;
  /** One line of context under the title (cycle id, what is filtered). */
  subtitle: string;
  regions: RegionProgress[];
  onClose: () => void;
  /** Open a country's forecast (the old table's View button). */
  onView: (row: { entity: string; templateId: string }) => void;
  /** Prefilled reminder email (the old table's Send Chaser button). */
  onChase: (entity: Entity) => void;
  /** Entity → ISO timestamp of the last chaser sent this cycle. */
  chasers?: Record<string, string>;
  /** Empty-state copy when every country has cleared this view. */
  emptyMessage: string;
}

/**
 * Cycle progress, region by region — the old Dashboard table, folded into a
 * modal and made collapsible so a treasury user opens only the region they
 * are chasing. Serves both the "submissions received" and the "awaiting
 * approval" stat boxes; the caller filters the regions it passes in.
 *
 * The question this answers is "is it in yet?", so it carries no forecast
 * totals: a €k figure beside a country said nothing about whether that
 * country had reported, and reading a group total off a progress list was
 * never what anyone opened it for.
 */
export function CycleProgressModal({
  open,
  title,
  subtitle,
  regions,
  onClose,
  onView,
  onChase,
  chasers = {},
  emptyMessage,
}: CycleProgressModalProps) {
  // Everything starts closed: the modal opens on the shape of the cycle —
  // which regions are complete and which are not — and a region is opened
  // only when it is the one being chased.
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(regions.map((r) => r.name)),
  );
  const toggle = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const totals = useMemo(() => {
    const countries = regions.flatMap((r) => r.countries);
    return {
      count: countries.length,
      received: countries.filter((c) => c.received).length,
    };
  }, [regions]);

  return (
    <Modal
      open={open}
      title={title}
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
          {totals.received} of {totals.count} received
        </span>
      </div>

      {regions.length === 0 ? (
        <div className="empty-state">
          <div className="ic">✓</div>
          <p>{emptyMessage}</p>
        </div>
      ) : (
        <div className="region-list">
          {regions.map((region) => {
            const isOpen = !collapsed.has(region.name);
            const complete = region.received === region.countries.length;
            return (
              <div className="region-block" key={region.name}>
                <button
                  className="region-head"
                  aria-expanded={isOpen}
                  onClick={() => toggle(region.name)}
                >
                  <span className="region-caret" aria-hidden="true">
                    {isOpen ? '▾' : '▸'}
                  </span>
                  <strong>{region.name}</strong>
                  <span className="region-count">
                    {region.received} / {region.countries.length} received
                  </span>
                  <span
                    className={`region-bar${complete ? ' complete' : ''}`}
                    aria-hidden="true"
                  >
                    <span
                      style={{
                        width: `${Math.round((region.received / Math.max(region.countries.length, 1)) * 100)}%`,
                      }}
                    />
                  </span>
                </button>
                {isOpen && (
                  <div className="region-body">
                    {region.countries.map((c) => (
                      <div
                        className={`country-row ${stateRowClass(c.status)}`}
                        key={c.entity.name}
                      >
                        <strong className="country-name">{c.entity.name}</strong>
                        <StatusPill status={c.status} />
                        <span className="country-people">
                          {c.entity.submitter} → {c.entity.approver}
                        </span>
                        {c.needCommentary > 0 && (
                          <span className="badge-num warn">
                            {c.needCommentary} to explain
                          </span>
                        )}
                        <span className="row-flex country-actions">
                          <button
                            className="btn btn-ghost"
                            style={{ padding: '4px 10px', fontSize: 12 }}
                            title="Open this forecast in a dialog, without leaving the list"
                            onClick={() =>
                              onView({ entity: c.entity.name, templateId: c.templateId })
                            }
                          >
                            View
                          </button>
                          {c.status !== 'approved' && (
                            <>
                              {chasers[c.entity.name] && (
                                <span
                                  className="chased-note"
                                  title={new Date(chasers[c.entity.name]).toLocaleString()}
                                >
                                  {chasedLabel(chasers[c.entity.name])}
                                </span>
                              )}
                              <button
                                className="btn btn-ghost"
                                style={{ padding: '4px 10px', fontSize: 12 }}
                                title="Opens a prefilled reminder email in Outlook"
                                onClick={() => onChase(c.entity)}
                              >
                                {chasers[c.entity.name] ? 'Chase Again' : 'Send Chaser'}
                              </button>
                            </>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
