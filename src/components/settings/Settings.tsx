import { useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { ViewOnlyBadge } from '../common/ViewOnlyBadge';
import { currentUser, permissionsFor } from '../../data/session';
import { loadSettings, saveSettings } from '../../storage/localStorage';
import { DEFAULT_SETTINGS } from './defaults';
import type { Settings as SettingsModel } from '../../types';

/**
 * Cycle-rule and authentication configuration, persisted on change.
 *
 * Variance thresholds are NOT here. The percentage that flags a cell is set
 * per entity in Legal Entity Setup — a group-wide number flagged small
 * entities constantly and large ones never — so a group-wide variance panel
 * was a set of rules nobody tuned, sitting where people looked for the ones
 * that mattered.
 */
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
      {/* Two independent groups of settings, so they stand side by side and
          both fit on the screen at once; one control per row within each. */}
      <div className="content settings-columns">
        <div className="panel" data-tour="settings-cycle">
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
