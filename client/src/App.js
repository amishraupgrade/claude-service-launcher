import React, { useState, useEffect } from 'react';
import Toast from './Toast';
import Settings from './Settings';
import './App.css';

function App() {
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [branches, setBranches] = useState([]);
  const [prs, setPrs] = useState([]);
  const [serviceStatus, setServiceStatus] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [runQaAutomation, setRunQaAutomation] = useState(false);
  const [qaEnvironment, setQaEnvironment] = useState('');

  useEffect(() => {
    loadServices();
  }, []);

  useEffect(() => {
    if (selectedService) {
      setBranches([]);
      setPrs([]);
      setSelectedBranch('');
      setRunQaAutomation(false);
      setQaEnvironment('');

      loadBranches(selectedService);
      loadStatus(selectedService);
    }
  }, [selectedService]);

  useEffect(() => {
    const interval = setInterval(() => {
      services.forEach(service => loadStatus(service.name));
    }, 5000);
    return () => clearInterval(interval);
  }, [services]);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
  };

  const requestNotificationPermission = async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  };

  const showDesktopNotification = (title, body) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico' });
    }
  };

  useEffect(() => {
    requestNotificationPermission();
  }, []);

  const loadServices = async () => {
    try {
      const res = await fetch('/api/services');
      const data = await res.json();
      setServices(data);
    } catch (err) {
      console.error('Error loading services:', err);
      showToast('Failed to load services', 'error');
    }
  };

  const loadBranches = async (serviceName) => {
    try {
      const res = await fetch(`/api/services/${serviceName}/branches`);
      const data = await res.json();

      setBranches(data.all || ['master', 'main']);
      setPrs(data.prs || []);
      setSelectedBranch(data.current || data.all?.[0] || 'master');
    } catch (err) {
      console.error('Error loading branches:', err);
      setBranches(['master', 'main']);
      setPrs([]);
      setSelectedBranch('master');
    }
  };

  const loadStatus = async (serviceName) => {
    try {
      const res = await fetch(`/api/services/${serviceName}/status`);
      const data = await res.json();
      setServiceStatus(prev => ({ ...prev, [serviceName]: data }));
    } catch (err) {
      console.error('Error loading status:', err);
    }
  };

  const handleLaunch = async () => {
    if (!selectedService) return;

    setLoading(true);
    showToast('Preparing repository...', 'info');

    try {
      // Find selected PR info if it's a PR branch
      const selectedPR = prs.find(pr => pr.branch === selectedBranch);

      const res = await fetch(`/api/launch/${selectedService}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: selectedBranch,
          runQaAutomation,
          qaEnvironment,
          prNumber: selectedPR?.number
        })
      });

      const data = await res.json();

      if (data.success) {
        showToast(`Terminal opened for ${selectedService}`, 'success');
        showDesktopNotification('Claude Launched', `Terminal opened for ${selectedService} (${data.branch})`);
        setTimeout(() => {
          loadStatus(selectedService);
          loadServices(); // Reload to update last used
        }, 1000);
      } else {
        showToast(`Error: ${data.error}`, 'error');
      }
    } catch (error) {
      showToast(`Error: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard', 'success');
  };

  const openGitHub = (githubUrl) => {
    const webUrl = githubUrl.replace('git@github.com:', 'https://github.com/').replace('.git', '');
    window.open(webUrl, '_blank');
  };

  const openVSCode = async (serviceName) => {
    const service = services.find(s => s.name === serviceName);
    if (!service) return;

    try {
      const config = { cloneBaseDir: '/Users/amishra/services/repos' };
      const targetDir = service.localPath || `${config.cloneBaseDir}/${service.name}`;

      // This won't work from browser, but we can copy the command
      const command = `code "${targetDir}"`;
      copyToClipboard(command);
      showToast('VS Code command copied. Run in terminal.', 'info');
    } catch (error) {
      showToast('Failed to open VS Code', 'error');
    }
  };

  const filteredServices = services.filter(service =>
    service.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusIcon = (serviceName) => {
    const status = serviceStatus[serviceName];
    if (!status) return '⚪';
    if (status.isRunning) return '🟢';
    if (status.hasActiveSession) return '🟡';
    return '⚪';
  };

  const getStatusText = (serviceName) => {
    const status = serviceStatus[serviceName];
    if (!status || !status.exists) return 'Not cloned';

    const parts = [];
    if (status.currentBranch) parts.push(status.currentBranch);
    if (status.hasChanges) parts.push('uncommitted changes');
    if (status.behind > 0) parts.push(`${status.behind} behind`);
    if (status.ahead > 0) parts.push(`${status.ahead} ahead`);

    return parts.length > 0 ? parts.join(' • ') : 'Up to date';
  };

  const getLastUsedText = (lastUsed) => {
    if (!lastUsed) return null;

    const now = Date.now();
    const diff = now - lastUsed;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(lastUsed).toLocaleDateString();
  };

  return (
    <div className="App">
      <div className="container">
        <div className="header-row">
          <div>
            <h1>Claude Service Launcher</h1>
            <p className="subtitle">Select a service to open Claude in its directory</p>
          </div>
          <button className="settings-btn" onClick={() => setShowSettings(true)}>
            ⚙️ Settings
          </button>
        </div>

        <div className="search-box">
          <input
            type="text"
            placeholder="🔍 Search services... (Cmd+K)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSearchTerm('');
            }}
            className="search-input"
          />
          {searchTerm && (
            <button className="clear-search" onClick={() => setSearchTerm('')}>
              ✕
            </button>
          )}
        </div>

        <div className="services-list">
          {filteredServices.map(service => {
            const isSelected = selectedService === service.name;
            const statusInfo = serviceStatus[service.name];
            const lastUsedText = getLastUsedText(service.lastUsed);

            return (
              <div
                key={service.name}
                className={`service-card ${isSelected ? 'selected' : ''}`}
                onClick={() => setSelectedService(service.name)}
              >
                <div className="service-header">
                  <span className="status-icon">{getStatusIcon(service.name)}</span>
                  <span className="service-name">{service.name}</span>
                </div>
                <div className="service-info">
                  {getStatusText(service.name)}
                  {service.isAutoDiscovered && (
                    <span className="auto-badge"> • Auto</span>
                  )}
                  {lastUsedText && (
                    <span className="last-used"> • {lastUsedText}</span>
                  )}
                </div>
                {statusInfo?.hasChanges && (
                  <div className="service-badge warning">
                    {statusInfo.modified + statusInfo.created + statusInfo.deleted} changes
                  </div>
                )}
                {statusInfo?.isRunning && (
                  <div className="service-badge active">Claude Running</div>
                )}

                {/* Quick Actions */}
                <div className="quick-actions" onClick={e => e.stopPropagation()}>
                  <button
                    className="quick-action-btn"
                    onClick={() => openGitHub(service.githubUrl)}
                    title="Open in GitHub"
                  >
                    📦
                  </button>
                  <button
                    className="quick-action-btn"
                    onClick={() => openVSCode(service.name)}
                    title="Open in VS Code"
                  >
                    💻
                  </button>
                  <button
                    className="quick-action-btn"
                    onClick={() => copyToClipboard(service.githubUrl)}
                    title="Copy URL"
                  >
                    📋
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {filteredServices.length === 0 && searchTerm && (
          <div className="no-results">
            No services found matching "{searchTerm}"
          </div>
        )}

        {selectedService && (
          <div className="launch-section">
            <div className="branch-selector">
              <label>Branch or PR:</label>
              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                disabled={loading || (branches.length === 0 && prs.length === 0)}
              >
                {prs.length > 0 && (
                  <optgroup label="📋 Open Pull Requests">
                    {prs.map(pr => (
                      <option key={`pr-${pr.number}`} value={pr.branch}>
                        #{pr.number} - {pr.title} (@{pr.author})
                      </option>
                    ))}
                  </optgroup>
                )}
                {branches.length > 0 && (
                  <optgroup label="🌿 Branches">
                    {branches.map(branch => (
                      <option key={branch} value={branch}>
                        {branch}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            <div className="qa-automation-section">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={runQaAutomation}
                  onChange={(e) => setRunQaAutomation(e.target.checked)}
                  disabled={loading}
                />
                <span>Run QA Automation</span>
              </label>
              {runQaAutomation && (
                <>
                  <input
                    type="text"
                    className="env-input"
                    placeholder="Environment (e.g., dev, staging)"
                    value={qaEnvironment}
                    onChange={(e) => setQaEnvironment(e.target.value)}
                    disabled={loading}
                  />
                  <p className="env-warning">
                    ⚠️ Make sure you have the given service PR deployed on this environment before running tests.
                  </p>
                </>
              )}
            </div>

            <button
              className="launch-button"
              onClick={handleLaunch}
              disabled={!selectedService || loading}
            >
              {loading ? 'Launching...' : `Launch ${selectedService}`}
            </button>
          </div>
        )}

        <div className="legend">
          <div className="legend-item">
            <span className="legend-icon">🟢</span>
            <span>Claude Running</span>
          </div>
          <div className="legend-item">
            <span className="legend-icon">🟡</span>
            <span>Session Active</span>
          </div>
          <div className="legend-item">
            <span className="legend-icon">⚪</span>
            <span>Idle</span>
          </div>
        </div>
      </div>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onSave={() => {
            setShowSettings(false);
            showToast('Settings saved! Refreshing services...', 'success');
            setTimeout(() => {
              window.location.reload();
            }, 1000);
          }}
        />
      )}
    </div>
  );
}

export default App;
