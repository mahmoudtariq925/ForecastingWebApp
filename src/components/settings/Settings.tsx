import { useState } from 'react';
import { TopBar } from '../layout/TopBar';
import { loadSettings, saveSettings } from '../../storage/localStorage';
import { DEFAULT_SETTINGS } from './defaults';
import type { Settings as SettingsModel } from '../../types';

/** Variance-threshold and cycle-rule configuration, persisted on change. */
export function Settings() {
  const [settings, setSettings] = useState<SettingsModel>(() => loadSettings(DEFAULT_SETTINGS));

  const update = <K extends keyof SettingsModel>(key: K, value: SettingsModel[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveSettings(next);
  };

  return (
    <div className="view active">
      <TopBar crumb="Administration" title="Settings" />
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
                onChange={(e) => update('allowedDomains', e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
