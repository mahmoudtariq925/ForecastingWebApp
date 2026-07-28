import { useMemo, useRef, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { useDialog } from '../common/dialogContext';
import { listEntities, seedUsers } from '../../data/appData';
import { listLegalEntities } from '../../data/legalEntityService';
import { templatesForEntity } from '../../data/submissionService';
import {
  currentWeekKey,
  shiftWeeks,
  templateDates,
  weekLabel,
} from '../../data/periods';
import {
  listSubmissions,
  loadTemplates,
  loadUsers,
  removeSubmission,
  saveSubmission,
} from '../../storage/localStorage';
import { parseValuesUpload } from '../../utils/excel';
import type { Submission } from '../../types';
import type { ViewId } from '../../types/nav';

interface DataImportProps {
  onNavigate: (view: ViewId) => void;
}

/** Sum of a stored submission's cell values, in EUR thousands. */
const submissionTotal = (s: Submission): number =>
  Object.values(s.values ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);

/**
 * Live-instance setup screen: populate the app with real numbers by
 * uploading Excel/CSV workbooks. Parsing is the exact same importer the
 * Submission screen uses, so anything that imports there imports here —
 * the file's layout is auto-detected and line items match by label.
 */
export function DataImport({ onNavigate }: DataImportProps) {
  const { confirm, notify } = useDialog();
  const fileRef = useRef<HTMLInputElement>(null);
  // Bumped after every import/removal so lists and totals refresh.
  const [version, setVersion] = useState(0);

  // `version` is the manual refresh trigger for store-backed reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entities = useMemo(() => listEntities(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const templates = useMemo(() => loadTemplates(), [version]);
  const stored = useMemo(
    () =>
      listSubmissions().sort(
        (a, b) => b.period.localeCompare(a.period) || a.entity.localeCompare(b.entity),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );

  const [entity, setEntity] = useState('');
  const selectedEntity = entities.some((e) => e.name === entity)
    ? entity
    : entities[0]?.name ?? '';
  const available = selectedEntity ? templatesForEntity(templates, selectedEntity) : templates;
  const [templateId, setTemplateId] = useState('');
  const template = available.find((t) => t.id === templateId) ?? available[0] ?? null;
  const [week, setWeek] = useState(() => currentWeekKey());
  const [busy, setBusy] = useState(false);

  // Recent weeks first, a few ahead for pre-loading next cycles.
  const weekOptions = useMemo(() => {
    const now = currentWeekKey();
    const out: string[] = [];
    for (let i = 4; i >= -12; i--) out.push(shiftWeeks(now, i));
    return out;
  }, []);

  // ---- Setup checklist (this screen doubles as the live onboarding) ----
  const setup = useMemo(() => {
    const legal = listLegalEntities();
    const users = loadUsers(seedUsers());
    return {
      entities: legal.filter((e) => e.status === 'active').length,
      users: users.length,
      assigned: legal.some(
        (e) => e.submitters.length + e.approvers.length + e.viewers.length > 0,
      ),
      imports: stored.length,
    };
  }, [stored, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const importFile = async (file: File) => {
    if (!selectedEntity || !template) return;
    setBusy(true);
    try {
      const dates = templateDates(template, week);
      const parsed = await parseValuesUpload(file, template, dates);
      const submission: Submission = {
        period: week,
        entity: selectedEntity,
        templateId: template.id,
        status: 'draft',
        values: parsed.values,
        flags: [],
        resolvedFlags: [],
        comments: {},
        dayComments: parsed.dayComments,
        startingBalance: parsed.startingBalance ?? 0,
        updatedAt: new Date().toISOString(),
      };
      saveSubmission(submission);
      setVersion((n) => n + 1);
      await notify({
        tone: 'success',
        title: 'Data imported',
        message:
          `${file.name}: matched ${parsed.matched} line item${parsed.matched === 1 ? '' : 's'} ` +
          `into ${selectedEntity} · ${weekLabel(week)}. ` +
          `Total ${Math.round(submissionTotal(submission)).toLocaleString()}k.`,
      });
    } catch (err) {
      await notify({
        tone: 'error',
        title: 'Import failed',
        message: err instanceof Error ? err.message : 'The file could not be read.',
      });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeImport = async (s: Submission) => {
    const confirmed = await confirm({
      title: 'Remove imported data',
      message: `Remove the ${s.entity} forecast for ${weekLabel(s.period)}? The numbers are deleted from this browser.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!confirmed) return;
    removeSubmission(s.period, s.entity, s.templateId);
    setVersion((n) => n + 1);
  };

  const steps: { done: boolean; label: string; hint: string; view?: ViewId }[] = [
    {
      done: setup.entities > 0,
      label: 'Add your legal entities',
      hint:
        setup.entities > 0
          ? `${setup.entities} configured`
          : 'Create each reporting entity (country/company) first.',
      view: 'legalEntities',
    },
    {
      done: setup.users > 1,
      label: 'Create your users',
      hint:
        setup.users > 1
          ? `${setup.users} users`
          : 'Add the real submitters, approvers and viewers with their roles.',
      view: 'users',
    },
    {
      done: setup.assigned,
      label: 'Assign entity responsibilities',
      hint: setup.assigned
        ? 'Assignments in place'
        : 'Connect users to their entities in Legal Entity Setup.',
      view: 'legalEntities',
    },
    {
      done: setup.imports > 0,
      label: 'Import forecast data',
      hint:
        setup.imports > 0
          ? `${setup.imports} forecast${setup.imports === 1 ? '' : 's'} loaded`
          : 'Upload an Excel or CSV workbook per entity and week below.',
    },
  ];

  return (
    <div className="view">
      <TopBar crumb="Administration" title="Data Import" />
      <div className="content">
        <div className="panel">
          <div className="panel-header">
            <h3>Getting started</h3>
            <span className="tag">live instance setup</span>
          </div>
          <div className="panel-body">
            <div className="setup-steps">
              {steps.map((s, i) => (
                <div key={s.label} className={`setup-step${s.done ? ' done' : ''}`}>
                  <span className="setup-step-mark">{s.done ? '✓' : i + 1}</span>
                  <div className="setup-step-text">
                    <div className="setup-step-label">{s.label}</div>
                    <div className="setup-step-hint">{s.hint}</div>
                  </div>
                  {s.view && (
                    <button className="btn btn-ghost" onClick={() => onNavigate(s.view!)}>
                      Open
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel" data-tour="data-import">
          <div className="panel-header">
            <h3>Import a workbook</h3>
            <span className="tag">.xlsx or .csv · same importer as My Submissions</span>
          </div>
          <div className="panel-body">
            {entities.length === 0 ? (
              <p className="text-dim" style={{ margin: 0 }}>
                Add a legal entity first — imported numbers always belong to an entity.
              </p>
            ) : (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Entity</label>
                    <select
                      className="form-select"
                      value={selectedEntity}
                      onChange={(e) => setEntity(e.target.value)}
                      aria-label="Import entity"
                    >
                      {entities.map((e) => (
                        <option key={e.name} value={e.name}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Forecast Week</label>
                    <select
                      className="form-select"
                      value={week}
                      onChange={(e) => setWeek(e.target.value)}
                      aria-label="Import week"
                    >
                      {weekOptions.map((w) => (
                        <option key={w} value={w}>
                          {weekLabel(w)}
                          {w === currentWeekKey() ? ' · current' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Template</label>
                    <select
                      className="form-select"
                      value={template?.id ?? ''}
                      onChange={(e) => setTemplateId(e.target.value)}
                      aria-label="Import template"
                    >
                      {available.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="row-flex" style={{ marginTop: 12 }}>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.csv"
                    style={{ display: 'none' }}
                    aria-label="Workbook file"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void importFile(f);
                    }}
                  />
                  <button
                    className="btn btn-primary"
                    disabled={busy || !template}
                    onClick={() => fileRef.current?.click()}
                  >
                    {busy ? 'Importing…' : 'Choose File & Import'}
                  </button>
                  <span className="text-dim" style={{ fontSize: 12 }}>
                    Line items are matched by label to “{template?.name ?? '—'}”. Values in
                    EUR thousands; money out as negatives.
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Imported forecasts</h3>
            <span className="tag">
              {stored.length} stored · totals update every screen
            </span>
          </div>
          <div className="panel-body no-pad">
            {stored.length === 0 ? (
              <p className="text-dim" style={{ margin: 0, padding: 16 }}>
                Nothing imported yet. Each upload appears here and immediately drives the
                dashboards, consolidation and comparisons.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Entity</th>
                    <th>Week</th>
                    <th>Template</th>
                    <th style={{ textAlign: 'right' }}>Total (€k)</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {stored.map((s) => (
                    <tr key={`${s.period}:${s.entity}:${s.templateId}`}>
                      <td>{s.entity}</td>
                      <td className="text-dim">{weekLabel(s.period)}</td>
                      <td className="text-dim">
                        {templates.find((t) => t.id === s.templateId)?.name ?? s.templateId}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {Math.round(submissionTotal(s)).toLocaleString()}
                      </td>
                      <td className="text-dim">{s.status}</td>
                      <td className="text-dim">
                        {new Date(s.updatedAt).toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={() => void removeImport(s)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
