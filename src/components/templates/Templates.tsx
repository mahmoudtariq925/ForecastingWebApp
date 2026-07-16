import { useEffect, useRef, useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { Modal } from '../common/Modal';
import { ErrorView, LoadingView } from '../common/Async';
import { useApi } from '../../hooks/useApi';
import {
  deleteTemplate,
  downloadTemplateFile,
  getEntities,
  getTemplates,
  replaceTemplateFile,
  updateTemplate,
  uploadTemplate,
} from '../../api/resources';
import { STANDARD_TEMPLATE_ID } from '../../data/demoData';
import { downloadBlob, XLSX_MIME } from '../../utils/download';
import type { ForecastTemplate, TemplateLayout } from '../../types';

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
 * Admin screen for forecast templates. Uploads send the .xlsx to the API,
 * which stores the physical file and parses the structure server-side;
 * assignment, rename, layout, replace and remove are all API operations.
 */
export function Templates() {
  const { data, error, loading, reload } = useApi(() =>
    Promise.all([getTemplates(), getEntities()]),
  );
  const [templates, setTemplates] = useState<ForecastTemplate[]>([]);
  const [editing, setEditing] = useState<ForecastTemplate | null>(null);
  const [editName, setEditName] = useState('');
  const [editLayout, setEditLayout] = useState<TemplateLayout>('grouped');
  const [editEntities, setEditEntities] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadLayout, setUploadLayout] = useState<TemplateLayout | 'auto'>('auto');
  const [busy, setBusy] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  useEffect(() => {
    if (data) setTemplates(data[0]);
  }, [data]);

  if (error) return <ErrorView crumb="Administration" title="Forecast Templates" message={error} onRetry={reload} />;
  if (loading && templates.length === 0) return <LoadingView crumb="Administration" title="Forecast Templates" />;
  const entities = data?.[1] ?? [];

  const fail = (verb: string) => (err: unknown) =>
    alert(`${verb} failed: ${err instanceof Error ? err.message : String(err)}`);

  const handleUpload = async (file: File) => {
    setUploadOpen(false);
    setBusy(true);
    try {
      const created = await uploadTemplate(file, uploadLayout, 'Maja Kowalska');
      setTemplates((prev) => [...prev, created]);
      openEdit(created);
    } catch (err) {
      fail('Upload')(err);
    } finally {
      setBusy(false);
    }
  };

  const handleReplace = async (file: File) => {
    const id = replaceTarget.current;
    replaceTarget.current = null;
    if (!id) return;
    setBusy(true);
    try {
      const updated = await replaceTemplateFile(id, file);
      setTemplates((prev) => prev.map((t) => (t.id === id ? updated : t)));
      alert(`Template structure replaced from ${file.name} (${updated.categories.length} line items).`);
    } catch (err) {
      fail('Replace')(err);
    } finally {
      setBusy(false);
    }
  };

  const download = async (t: ForecastTemplate) => {
    try {
      const blob = await downloadTemplateFile(t.id);
      downloadBlob(blob, t.fileName ?? `${t.name}.xlsx`, XLSX_MIME);
    } catch (err) {
      fail('Download')(err);
    }
  };

  const remove = async (t: ForecastTemplate) => {
    const warning =
      t.id === STANDARD_TEMPLATE_ID
        ? `Remove the built-in "${t.name}" template? Entities without another assigned template will lose their default.`
        : `Remove template "${t.name}"? Existing submissions made with it remain stored.`;
    if (!confirm(warning)) return;
    try {
      await deleteTemplate(t.id);
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
    } catch (err) {
      fail('Remove')(err);
    }
  };

  const openEdit = (t: ForecastTemplate) => {
    setEditing(t);
    setEditName(t.name);
    setEditLayout(t.layout);
    setEditEntities(new Set(t.assignedEntities));
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      const updated = await updateTemplate(editing.id, {
        name: editName.trim() || editing.name,
        layout: editLayout,
        assignedEntities: [...editEntities],
      });
      setTemplates((prev) => prev.map((t) => (t.id === editing.id ? updated : t)));
      setEditing(null);
    } catch (err) {
      fail('Save')(err);
    }
  };

  const toggleEntity = (name: string) => {
    const next = new Set(editEntities);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setEditEntities(next);
  };

  return (
    <div className="view active">
      <TopBar
        crumb="Administration"
        title="Forecast Templates"
        actions={
          <button className="btn btn-primary" disabled={busy} onClick={() => setUploadOpen(true)}>
            {busy ? 'Working…' : '+ Upload Template'}
          </button>
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
                .xlsx · structure is derived from the workbook · both layouts supported
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
                      <td className="text-dim">{t.fileName ?? '—'}</td>
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
                          <button
                            className="btn btn-ghost"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            onClick={() => openEdit(t)}
                          >
                            Edit
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
                          {t.hasFile && (
                            <button
                              className="btn btn-ghost"
                              style={{ padding: '4px 10px', fontSize: 11 }}
                              onClick={() => download(t)}
                            >
                              Download
                            </button>
                          )}
                          <button
                            className="btn btn-danger"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            onClick={() => remove(t)}
                          >
                            Remove
                          </button>
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
          <label className="form-label">Template Layout</label>
          <select
            className="form-select"
            value={uploadLayout}
            onChange={(e) => setUploadLayout(e.target.value as TemplateLayout | 'auto')}
          >
            <option value="auto">Auto-detect from the workbook</option>
            <option value="grouped">Grouped — one row per day, categories across columns</option>
            <option value="days-across">Days across columns — one row per line item</option>
          </select>
          <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
            The file is uploaded to the server, which stores it and derives the template
            structure from the workbook. Grouped workbooks need a “Date” header column;
            days-across workbooks list line items in the first column.
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
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Template Name</label>
            <input
              className="form-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Layout</label>
            <select
              className="form-select"
              value={editLayout}
              onChange={(e) => setEditLayout(e.target.value as TemplateLayout)}
            >
              <option value="grouped">{LAYOUT_LABELS.grouped}</option>
              <option value="days-across">{LAYOUT_LABELS['days-across']}</option>
            </select>
          </div>
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
