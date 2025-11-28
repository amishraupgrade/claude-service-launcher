import React, { useState, useEffect } from 'react';
import './Settings.css';

function Settings({ onClose, onSave }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        setSettings(data);
        setLoading(false);
      })
      .catch(err => console.error('Error loading settings:', err));
  }, []);

  const handleSave = async () => {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      onSave();
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  };

  if (loading) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="settings-body">
          <div className="setting-group">
            <label>GitHub Organization</label>
            <input
              type="text"
              value={settings.orgName}
              onChange={e => setSettings({...settings, orgName: e.target.value})}
            />
          </div>

          <div className="setting-group">
            <label>Cache Duration (hours)</label>
            <input
              type="number"
              value={settings.cacheDuration}
              onChange={e => setSettings({...settings, cacheDuration: parseInt(e.target.value)})}
              min="1"
              max="168"
            />
          </div>

          <div className="setting-group">
            <label>Exclude repos starting with (comma-separated)</label>
            <input
              type="text"
              value={settings.exclusions.startsWith.join(', ')}
              onChange={e => setSettings({
                ...settings,
                exclusions: {
                  ...settings.exclusions,
                  startsWith: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                }
              })}
            />
          </div>

          <div className="setting-group">
            <label>Exclude repos ending with (comma-separated)</label>
            <input
              type="text"
              value={settings.exclusions.endsWith.join(', ')}
              onChange={e => setSettings({
                ...settings,
                exclusions: {
                  ...settings.exclusions,
                  endsWith: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                }
              })}
            />
          </div>

          <div className="setting-group">
            <label>Exclude repos containing (comma-separated)</label>
            <input
              type="text"
              value={settings.exclusions.contains.join(', ')}
              onChange={e => setSettings({
                ...settings,
                exclusions: {
                  ...settings.exclusions,
                  contains: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                }
              })}
            />
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>Save Settings</button>
        </div>
      </div>
    </div>
  );
}

export default Settings;
