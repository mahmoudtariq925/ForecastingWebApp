import { useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { ViewOnlyBadge } from '../common/ViewOnlyBadge';
import { currentUser, permissionsFor } from '../../data/session';
import { loadSettings, saveSettings } from '../../storage/localStorage';
import { DEFAULT_SETTINGS } from './defaults';
import type { Settings as SettingsModel } from '../../types';

/** Variance-threshold, cycle-rule and authentication configuration, persisted on change. */
export function Settings() {
  const [settings, setSettings] = useState<SettingsModel>(() => loadSettings(DEFAULT_SETTINGS));
  const canEdit = permissionsFor(currentUser()).canManageSettings;

  const update = <K extends keyof SettingsModel>(key: K, value: SettingsModel[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveSettings(next);
  };

  return (
    <div className="view active">
      <TopBar
        crumb="Administration"
        title="Settings"
        actions={canEdit ? undefined : <ViewOnlyBadge />}
      />
      {/* One setting per row, stacked — a two-column grid of unrelated
          dropdowns reads as a form to fill in rather than a list of rules. */}
      <div className="content">
        <div className="panel">
          <div className="panel-header">
            <h3>Cycle Configuration</h3>
          </div>
          <div className="panel-body settings-stack">
            <div className="form-group">
              <label className="form-label">Forecast Horizon</label>
              <select
                className="form-select"
                value={settings.horizon}
                disabled={!canEdit}
                onChange={(e) => update('horizon', e.target.value)}
              >
                <option>30 days</option>
                <option>13 weeks</option>
                <option>90 days</option>
              </select>
              <div className="settings-hint">How far ahead every forecast looks</div>
            </div>
            <div className="form-group">
              <label className="form-label">Cycle Frequency</label>
              <select
                className="form-select"
                value={settings.frequency}
                disabled={!canEdit}
                onChange={(e) => update('frequency', e.target.value)}
              >
                <option>Weekly (Mon → Fri close)</option>
                <option>Bi-weekly</option>
                <option>Monthly</option>
              </select>
              <div className="settings-hint">How often a new cycle opens for entry</div>
            </div>
          </div>
        </div>

        <div className="panel" data-tour="settings-variance">
          <div className="panel-header">
            <h3>Variance Rules</h3>
          </div>
          <div className="panel-body settings-stack">
            {/* The threshold itself is set per entity, in Legal Entity Setup —
                a group-wide percentage flagged small entities constantly and
                large ones never. */}
            <div className="variance-panel" style={{ marginBottom: 0 }}>
              <h4>Variance threshold</h4>
              <div className="row">
                <span>
                  The percentage that flags a cell for commentary is set per entity, under{' '}
                  <strong>Legal Entity Setup</strong>. Entities without one fall back to ±
                  {settings.varianceThreshold}%.
                </span>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Minimum Value to Trigger</label>
              <input
                className="form-input"
                value={settings.minValueToTrigger}
                disabled={!canEdit}
                onChange={(e) => update('minValueToTrigger', e.target.value)}
              />
              <div className="settings-hint">
                Variances on cells below this absolute value are ignored
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Exempt New Periods</label>
              <select
                className="form-select"
                value={settings.exemptNewPeriods}
                disabled={!canEdit}
                onChange={(e) => update('exemptNewPeriods', e.target.value)}
              >
                <option>Yes — never flag days outside prior cycle's horizon</option>
                <option>No — always flag</option>
              </select>
              <div className="settings-hint">
                Days the previous forecast never covered have nothing to compare against
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Authentication</h3>
          </div>
          <div className="panel-body settings-stack">
            <div className="form-group">
              <label className="form-label">SSO Provider</label>
              <input className="form-input" value={settings.ssoProvider} disabled />
            </div>
            <div className="form-group">
              <label className="form-label">Allowed Domains</label>
              <input
                className="form-input"
                value={settings.allowedDomains}
                disabled={!canEdit}
                onChange={(e) => update('allowedDomains', e.target.value)}
              />
              <div className="settings-hint">Only these email domains can sign in</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
