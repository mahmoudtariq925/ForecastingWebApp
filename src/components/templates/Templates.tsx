import { useRef, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { Modal } from '../common/Modal';
import { useDialog } from '../common/dialogContext';
import { ViewOnlyBadge } from '../common/ViewOnlyBadge';
import { TemplateEditor } from './TemplateEditor';
import { STANDARD_TEMPLATE_ID } from '../../data/mockData';
import { listEntities } from '../../data/appData';
import { currentWeekKey, dayLabelsForWeek, horizonDates } from '../../data/periods';
import { currentUser, permissionsFor } from '../../data/session';
import { loadTemplates, saveTemplates } from '../../storage/localStorage';
import { exportTemplateXlsx, parseTemplateFile } from '../../utils/excel';
import { base64ToBlob, downloadBlob, fileToBase64, XLSX_MIME } from '../../utils/download';
import type { ForecastTemplate, TemplateLayout } from '../../types';

// localStorage-backed phase: keep stored template files small.
const MAX_FILE_BYTES = 1_000_000;

const LAYOUT_LABELS: Record<TemplateLayout, string> = {
  'days-across': 'Days across columns',
  grouped: 'Grouped (one row per day)',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Admin screen for forecast templates: upload .xlsx files (structure is
 * derived from the workbook itself), choose the layout, assign templates to
 * entities, and view / update / replace / remove existing ones.
 */
export function Templates() {
  const canManage = permissionsFor(currentUser()).canManageTemplates;
  const entities = listEntities();
  const { confirm, notify } = useDialog();
  const [templates, setTemplates] = useState<ForecastTemplate[]>(() => loadTemplates());
  const [editing, setEditing] = useState<ForecastTemplate | null>(null);
  const [editName, setEditName] = useState('');
  const [editEntities, setEditEntities] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  // null = editor closed; { template: null } = authoring a new template.
  const [editorTarget, setEditorTarget] = useState<{ template: ForecastTemplate | null } | null>(
    null,
  );
  const uploadInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  const commit = (next: ForecastTemplate[]) => {
    setTemplates(next);
    saveTemplates(next);
  };

  const handleUpload = async (file: File) => {
    setUploadOpen(false);
    if (file.size > MAX_FILE_BYTES) {
      await notify({
        title: 'File too large',
        tone: 'error',
        message: 'This file exceeds the 1 MB browser-storage limit used in Phase 1.',
      });
      return;
    }
    try {
      // Structure AND orientation are auto-detected from the workbook; the
      // on-screen orientation is chosen dynamically on the Submission screen.
      const parsed = await parseTemplateFile(file, 'auto');
      const fileData = await fileToBase64(file);
      const template: ForecastTemplate = {
        id: `tpl-${Date.now()}`,
        name: file.name.replace(/\.xlsx$/i, ''),
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
        uploadedBy: currentUser().name,
        assignedEntities: [],
        layout: parsed.layout,
        categories: parsed.categories,
        fileData,
      };
      commit([...templates, template]);
      openEdit(template);
    } catch (err) {
      await notify({
        title: 'Upload failed',
        tone: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleReplace = async (file: File) => {
    const id = replaceTarget.current;
    replaceTarget.current = null;
    if (!id) return;
    if (file.size > MAX_FILE_BYTES) {
      await notify({
        title: 'File too large',
        tone: 'error',
        message: 'This file exceeds the 1 MB browser-storage limit used in Phase 1.',
      });
      return;
    }
    try {
      const target = templates.find((t) => t.id === id);
      const parsed = await parseTemplateFile(file, target?.layout ?? 'auto');
      const fileData = await fileToBase64(file);
      commit(
        templates.map((t) =>
          t.id === id
            ? {
                ...t,
                layout: parsed.layout,
                categories: parsed.categories,
                fileData,
                fileName: file.name,
                uploadedAt: new Date().toISOString(),
              }
            : t,
        ),
      );
      await notify({
        tone: 'success',
        message: `Template structure replaced from ${file.name} (${parsed.categories.length} line items).`,
      });
    } catch (err) {
      await notify({
        title: 'Replace failed',
        tone: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const download = (t: ForecastTemplate) => {
    if (t.fileData) {
      downloadBlob(base64ToBlob(t.fileData, XLSX_MIME), t.fileName ?? `${t.name}.xlsx`, XLSX_MIME);
    } else {
      // Seeded template has no stored file — generate a blank workbook from
      // its structure for the current forecast week.
      const week = currentWeekKey();
      exportTemplateXlsx(t, horizonDates(week), dayLabelsForWeek(week)).catch((err) =>
        notify({
          title: 'Download failed',
          tone: 'error',
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  };

  const remove = async (t: ForecastTemplate) => {
    const confirmed = await confirm({
      title: 'Remove template',
      message:
        t.id === STANDARD_TEMPLATE_ID
          ? `Remove the built-in "${t.name}" template? Entities without another assigned template will lose their default.`
          : `Remove template "${t.name}"? Existing submissions made with it remain stored.`,
      confirmLabel: 'Remove Template',
      danger: true,
    });
    if (!confirmed) return;
    commit(templates.filter((x) => x.id !== t.id));
  };

  const openEdit = (t: ForecastTemplate) => {
    setEditing(t);
    setEditName(t.name);
    setEditEntities(new Set(t.assignedEntities));
  };

  const saveEdit = () => {
    if (!editing) return;
    commit(
      templates.map((t) =>
        t.id === editing.id
          ? {
              ...t,
              name: editName.trim() || t.name,
              assignedEntities: [...editEntities],
            }
          : t,
      ),
    );
    setEditing(null);
  };

  /** Persist a template authored in the in-browser editor. */
  const saveFromEditor = (next: ForecastTemplate) => {
    const exists = templates.some((t) => t.id === next.id);
    commit(exists ? templates.map((t) => (t.id === next.id ? next : t)) : [...templates, next]);
    setEditorTarget(null);
  };

  const toggleEntity = (name: string) => {
    const next = new Set(editEntities);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setEditEntities(next);
  };

  if (editorTarget) {
    return (
      <TemplateEditor
        template={editorTarget.template}
        onSave={saveFromEditor}
        onCancel={() => setEditorTarget(null)}
      />
    );
  }

  return (
    <div className="view active">
      <TopBar
        crumb="Administration"
        title="Forecast Templates"
        actions={
          canManage ? (
            <>
              <button className="btn btn-ghost" onClick={() => setUploadOpen(true)}>
                Upload .xlsx
              </button>
              <button
                className="btn btn-primary"
                data-tour="create-template"
                onClick={() => setEditorTarget({ template: null })}
              >
                + Create Template
              </button>
            </>
          ) : (
            <ViewOnlyBadge />
          )
        }
      />
      <div className="content">
        <div className="panel">
          <div className="grid-toolbar">
            <div className="grid-info">
              <strong>
                {templates.length} template{templates.length === 1 ? '' : 's'}
              </strong>{' '}
              ·{' '}
              <span className="text-muted">
                build one in the browser or upload an .xlsx — both produce the same structure
              </span>
            </div>
          </div>
          <div className="panel-body no-pad">
            {templates.length === 0 ? (
              <div className="empty-state">
                <div className="ic">▦</div>
                <p>No templates yet. Upload an .xlsx file to get started.</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Template</th>
                    <th>Layout</th>
                    <th>Source File</th>
                    <th>Line Items</th>
                    <th>Assigned To</th>
                    <th>Updated</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <strong>{t.name}</strong>
                        {t.id === STANDARD_TEMPLATE_ID && (
                          <span className="role-tag treasury" style={{ marginLeft: 8 }}>
                            built-in
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="role-tag submitter">{LAYOUT_LABELS[t.layout]}</span>
                      </td>
                      <td className="text-dim">
                        {t.fileName ?? (
                          <span className="role-tag treasury">built in editor</span>
                        )}
                      </td>
                      <td className="text-dim">{t.categories.length} items</td>
                      <td className="text-dim" style={{ fontSize: 12, maxWidth: 240 }}>
                        {t.assignedEntities.length === 0
                          ? '—'
                          : t.assignedEntities.length === entities.length
                            ? 'All entities'
                            : t.assignedEntities.join(', ')}
                      </td>
                      <td className="text-muted" style={{ fontSize: 12 }}>
                        {formatDate(t.uploadedAt)}
                      </td>
                      <td>
                        <div className="row-flex">
                          {canManage && (
                            <>
                              <button
                                className="btn btn-ghost"
                                style={{ padding: '4px 10px', fontSize: 11 }}
                                onClick={() => setEditorTarget({ template: t })}
                                title="Open the spreadsheet editor"
                              >
                                Edit Structure
                              </button>
                              <button
                                className="btn btn-ghost"
                                style={{ padding: '4px 10px', fontSize: 11 }}
                                onClick={() => openEdit(t)}
                              >
                                Name &amp; Entities
                              </button>
                              <button
                                className="btn btn-ghost"
                                style={{ padding: '4px 10px', fontSize: 11 }}
                                onClick={() => {
                                  replaceTarget.current = t.id;
                                  replaceInput.current?.click();
                                }}
                              >
                                Replace
                              </button>
                            </>
                          )}
                          <button
                            className="btn btn-ghost"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            onClick={() => download(t)}
                          >
                            Download
                          </button>
                          {canManage && (
                            <button
                              className="btn btn-danger"
                              style={{ padding: '4px 10px', fontSize: 11 }}
                              onClick={() => remove(t)}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <input
          ref={uploadInput}
          type="file"
          accept=".xlsx"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            e.target.value = '';
          }}
        />
        <input
          ref={replaceInput}
          type="file"
          accept=".xlsx"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleReplace(file);
            e.target.value = '';
          }}
        />
      </div>

      <Modal
        open={uploadOpen}
        title="Upload Template"
        onClose={() => setUploadOpen(false)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setUploadOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => uploadInput.current?.click()}>
              Choose .xlsx File
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">How Uploads Are Read</label>
          <div className="text-muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            The structure and orientation are detected automatically from the workbook — no
            setup needed. Grouped workbooks need a “Date” header column followed by category
            columns (group bands come from the row above); days-across workbooks list line
            items in the first column, and rows containing formulas are treated as computed
            totals. On the Submission screen the grid can be flipped between dates-across and
            dates-down at any time, whatever the file looked like.
          </div>
        </div>
      </Modal>

      <Modal
        open={editing !== null}
        title="Edit Template"
        onClose={() => setEditing(null)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={saveEdit}>
              Save
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">Template Name</label>
          <input
            className="form-input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
          />
          {editing && (
            <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
              Source layout: {LAYOUT_LABELS[editing.layout]} (detected from the workbook — the
              on-screen orientation is switched on the Submission screen).
            </div>
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Assigned Countries / Regions</label>
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '10px 12px',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 6,
              maxHeight: 220,
              overflowY: 'auto',
            }}
          >
            {entities.map((en) => (
              <label key={en.name} className="row-flex" style={{ fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={editEntities.has(en.name)}
                  onChange={() => toggleEntity(en.name)}
                />
                {en.name}
              </label>
            ))}
          </div>
          <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
            Submitters in these countries can pick this template in My Submissions.
          </div>
        </div>
      </Modal>
    </div>
  );
}
