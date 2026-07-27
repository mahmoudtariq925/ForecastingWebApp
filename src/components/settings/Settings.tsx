import { useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { ViewOnlyBadge } from '../common/ViewOnlyBadge';
import { currentUser, permissionsFor } from '../../data/session';
import { loadSettings, saveSettings } from '../../storage/localStorage';
import { DEFAULT_SETTINGS } from './defaults';
import type { Settings as SettingsModel } from '../../types';

/** Variance-threshold, cycle-rule and access configuration, persisted on change. */
export function Settings() {
  const [settings, setSettings] = useState<SettingsModel>(() => loadSettings(DEFAULT_SETTINGS));
  const me = currentUser();
  const permissions = permissionsFor(me, settings);
  const canEdit = permissions.canManageSettings;
  // Only an admin may delegate management rights to Treasury.
  const canChangeToggle = permissions.canChangeTreasuryToggle;

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
      <div className="content">
        <div className="panel">
          <div className="panel-header">
            <h3>Cycle Configuration</h3>
          </div>
          <div className="panel-body">
            <div className="form-row">
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
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Variance Rules</h3>
          </div>
          <div className="panel-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Variance Threshold</label>
                <input
                  className="form-input"
                  value={settings.varianceThreshold}
                  disabled={!canEdit}
                  onChange={(e) => update('varianceThreshold', Number(e.target.value) || 0)}
                />
                <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
                  Cells exceeding ±X% vs prior cycle require commentary
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
                <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
                  Variances on cells below this absolute value are ignored
                </div>
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
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Access &amp; Delegation</h3>
          </div>
          <div className="panel-body">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="toggle-row" data-tour="treasury-toggle">
                <input
                  type="checkbox"
                  checked={settings.treasuryManagementEnabled === true}
                  disabled={!canChangeToggle}
                  onChange={(e) => update('treasuryManagementEnabled', e.target.checked)}
                />
                <span className="toggle-text">
                  <strong>Allow Treasury users to manage users and settings</strong>
                  <span className="text-muted">
                    When off, Treasury users can view User Management, Settings and Legal Entity
                    Setup but cannot change them. When on, they can manage all three. Only
                    administrators can change this setting.
                  </span>
                </span>
                <span className={`status ${settings.treasuryManagementEnabled ? 'approved' : 'draft'}`}>
                  <span className="dot" />
                  {settings.treasuryManagementEnabled ? 'enabled' : 'disabled'}
                </span>
              </label>
              {!canChangeToggle && (
                <div className="text-muted" style={{ fontSize: 11, marginTop: 10 }}>
                  Only an administrator can change this setting.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Authentication</h3>
          </div>
          <div className="panel-body">
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
