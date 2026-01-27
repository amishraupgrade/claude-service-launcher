import React, { useState, useEffect } from 'react';
import Toast from './Toast';
import Settings from './Settings';
import KnowledgeBase from './KnowledgeBase';
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
  const [commandHistory, setCommandHistory] = useState([]);
  const [showCommandModal, setShowCommandModal] = useState(false);
  const [newCommand, setNewCommand] = useState('');
  const [newOutput, setNewOutput] = useState('');
  const [commandTemplates, setCommandTemplates] = useState({ global: [], service: [] });
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateCommand, setNewTemplateCommand] = useState('');
  const [showKnowledgeBase, setShowKnowledgeBase] = useState(false);
  const [kbServiceName, setKbServiceName] = useState('');

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
      loadCommandHistory(selectedService);
      loadCommandTemplates(selectedService);
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

  const loadCommandHistory = async (serviceName, branch = null, prNumber = null) => {
    try {
      let url = `/api/services/${serviceName}/commands`;
      const params = new URLSearchParams();
      if (branch) params.append('branch', branch);
      if (prNumber) params.append('prNumber', prNumber);
      if (params.toString()) url += `?${params.toString()}`;

      const res = await fetch(url);
      const data = await res.json();
      setCommandHistory(data);
    } catch (err) {
      console.error('Error loading command history:', err);
      setCommandHistory([]);
    }
  };

  const loadCommandTemplates = async (serviceName) => {
    try {
      const res = await fetch(`/api/services/${serviceName}/templates`);
      const data = await res.json();
      setCommandTemplates(data);
    } catch (err) {
      console.error('Error loading templates:', err);
      setCommandTemplates({ global: [], service: [] });
    }
  };

  const applyTemplate = (template) => {
    setNewCommand(template.command);
    setNewOutput(''); // Clear output when using template
    setShowCommandModal(true);
  };

  const runInClaude = async () => {
    if (!newCommand.trim()) {
      showToast('Please enter a command first', 'error');
      return;
    }

    if (!selectedBranch) {
      showToast('Please select a branch first', 'error');
      return;
    }

    setLoading(true);
    showToast('Launching Claude with command...', 'info');

    try {
      const selectedPR = prs.find(pr => pr.branch === selectedBranch);

      const res = await fetch(`/api/launch/${selectedService}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: selectedBranch,
          prNumber: selectedPR?.number,
          prTitle: selectedPR?.title,
          claudeCommand: newCommand
        })
      });

      const data = await res.json();

      if (data.success) {
        showToast('Terminal launched! Command will run automatically.', 'success');
        showDesktopNotification('Claude Launched', `Running command in ${selectedService}`);
        setTimeout(() => {
          loadStatus(selectedService);
          loadServices();
        }, 1000);
      } else {
        showToast(`Error: ${data.error}`, 'error');
      }
    } catch (error) {
      showToast(`Error: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }

    // Keep modal open so user can save output later
  };

  const saveTemplate = async () => {
    if (!selectedService || !newTemplateName.trim() || !newTemplateCommand.trim()) {
      showToast('Please fill in template name and command', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/services/${selectedService}/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTemplateName,
          command: newTemplateCommand,
          category: 'custom'
        })
      });

      const data = await res.json();

      if (data.success) {
        showToast('Template saved successfully', 'success');
        setShowTemplateModal(false);
        setNewTemplateName('');
        setNewTemplateCommand('');
        loadCommandTemplates(selectedService);
      } else {
        showToast('Failed to save template', 'error');
      }
    } catch (error) {
      showToast(`Error: ${error.message}`, 'error');
    }
  };

  const saveCommand = async () => {
    if (!selectedService || !newCommand.trim() || !newOutput.trim()) {
      showToast('Please fill in both command and output', 'error');
      return;
    }

    try {
      const selectedPR = prs.find(pr => pr.branch === selectedBranch);

      const res = await fetch(`/api/services/${selectedService}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: newCommand,
          output: newOutput,
          branch: selectedBranch,
          prNumber: selectedPR?.number
        })
      });

      const data = await res.json();

      if (data.success) {
        showToast('Command saved successfully', 'success');
        setShowCommandModal(false);
        setNewCommand('');
        setNewOutput('');
        loadCommandHistory(selectedService, selectedBranch, selectedPR?.number);
      } else {
        showToast('Failed to save command', 'error');
      }
    } catch (error) {
      showToast(`Error: ${error.message}`, 'error');
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
          prNumber: selectedPR?.number,
          prTitle: selectedPR?.title
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

  const openPRDashboard = (githubUrl) => {
    const webUrl = githubUrl.replace('git@github.com:', 'https://github.com/').replace('.git', '');
    const prUrl = `${webUrl}/pulls`;
    window.open(prUrl, '_blank');
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

  const attachToSession = async (serviceName) => {
    try {
      showToast('Switching to active session...', 'info');
      const res = await fetch(`/api/sessions/${serviceName}/attach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await res.json();

      if (data.success) {
        showToast(`Switched to ${serviceName} session`, 'success');
        showDesktopNotification('Session Active', `Switched to ${serviceName} terminal (${data.branch})`);
      } else {
        showToast(`Error: ${data.error}`, 'error');
      }
    } catch (error) {
      showToast(`Error: ${error.message}`, 'error');
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
                  {statusInfo?.hasActiveSession && (
                    <>
                      <button
                        className="quick-action-btn active-session-btn"
                        onClick={() => attachToSession(service.name)}
                        title="Attach to active session"
                      >
                        🔗
                      </button>
                      <button
                        className="quick-action-btn"
                        onClick={() => openPRDashboard(service.githubUrl)}
                        title="View Pull Requests"
                      >
                        🔀
                      </button>
                    </>
                  )}
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
                  <button
                    className="quick-action-btn"
                    onClick={() => {
                      setKbServiceName(service.name);
                      setShowKnowledgeBase(true);
                    }}
                    title="View Documentation"
                  >
                    📖
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

        {selectedService && (commandTemplates.global.length > 0 || commandTemplates.service.length > 0) && (
          <div className="command-templates-section">
            <div className="templates-header">
              <h3>⚡ Command Templates</h3>
              <button
                className="add-template-btn"
                onClick={() => setShowTemplateModal(true)}
              >
                + Create Template
              </button>
            </div>

            {commandTemplates.global.length > 0 && (
              <div className="templates-group">
                <h4>Global Templates</h4>
                <div className="templates-grid">
                  {commandTemplates.global.map((template) => (
                    <button
                      key={template.id}
                      className="template-card"
                      onClick={() => applyTemplate(template)}
                      title={template.command}
                    >
                      <span className="template-name">{template.name}</span>
                      <span className="template-category">{template.category}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {commandTemplates.service.length > 0 && (
              <div className="templates-group">
                <h4>Custom Templates for {selectedService}</h4>
                <div className="templates-grid">
                  {commandTemplates.service.map((template) => (
                    <button
                      key={template.id}
                      className="template-card custom"
                      onClick={() => applyTemplate(template)}
                      title={template.command}
                    >
                      <span className="template-name">{template.name}</span>
                      <span className="template-category">{template.category}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {selectedService && commandHistory.length > 0 && (
          <div className="command-history-section">
            <div className="command-history-header">
              <h3>📝 Claude Command History</h3>
              <button
                className="add-command-btn"
                onClick={() => setShowCommandModal(true)}
              >
                + Save Command
              </button>
            </div>
            <div className="command-history-list">
              {commandHistory.map((cmd) => (
                <div key={cmd.id} className="command-history-item">
                  <div className="command-header">
                    <span className="command-text">"{cmd.command}"</span>
                    <span className="command-time">
                      {new Date(cmd.timestamp).toLocaleString()}
                    </span>
                  </div>
                  {cmd.branch && (
                    <span className="command-branch">
                      🌿 {cmd.branch}
                      {cmd.prNumber && ` (PR #${cmd.prNumber})`}
                    </span>
                  )}
                  <details className="command-output">
                    <summary>View output</summary>
                    <pre>{cmd.output}</pre>
                  </details>
                  <button
                    className="copy-command-btn"
                    onClick={() => {
                      copyToClipboard(cmd.command);
                      showToast('Command copied', 'success');
                    }}
                  >
                    📋 Copy
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {selectedService && commandHistory.length === 0 && (
          <div className="command-history-empty">
            <p>No command history yet</p>
            <button
              className="add-command-btn"
              onClick={() => setShowCommandModal(true)}
            >
              + Save Your First Command
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

      {showKnowledgeBase && (
        <KnowledgeBase
          serviceName={kbServiceName}
          onClose={() => setShowKnowledgeBase(false)}
        />
      )}

      {showCommandModal && (
        <div className="modal-overlay" onClick={() => setShowCommandModal(false)}>
          <div className="modal-content command-modal-enhanced" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="header-content">
                <h2>⚡ Claude Command Runner</h2>
                <div className="context-info-header">
                  <span>📍 {selectedService}</span>
                  {selectedBranch && <span>🌿 {selectedBranch}</span>}
                </div>
              </div>
              <button className="close-btn" onClick={() => setShowCommandModal(false)}>✕</button>
            </div>

            <div className="modal-body-enhanced">
              <div className="step-section">
                <div className="step-header">
                  <span className="step-number">1</span>
                  <h3>Edit Your Command</h3>
                </div>
                <textarea
                  className="command-input"
                  value={newCommand}
                  onChange={(e) => setNewCommand(e.target.value)}
                  placeholder="e.g., Analyze the authentication flow and find security issues"
                  rows="4"
                />
              </div>

              <div className="step-section">
                <div className="step-header">
                  <span className="step-number">2</span>
                  <h3>Run in Terminal</h3>
                </div>
                <button
                  className="run-claude-btn-enhanced"
                  onClick={runInClaude}
                  disabled={loading || !newCommand.trim()}
                >
                  <span className="btn-icon">▶️</span>
                  <span className="btn-text">
                    {loading ? 'Launching...' : 'Launch & Run Command'}
                  </span>
                </button>
                <p className="step-description">
                  This will open a terminal, checkout the branch, and automatically run your command in Claude
                </p>
              </div>

              <div className="step-section">
                <div className="step-header">
                  <span className="step-number">3</span>
                  <h3>Save Claude's Response</h3>
                </div>
                <textarea
                  className="output-input"
                  value={newOutput}
                  onChange={(e) => setNewOutput(e.target.value)}
                  placeholder="After Claude responds, copy and paste the output here to save for future reference..."
                  rows="6"
                />
              </div>
            </div>

            <div className="modal-footer-enhanced">
              <button className="cancel-btn" onClick={() => setShowCommandModal(false)}>
                Cancel
              </button>
              <button
                className="save-btn"
                onClick={saveCommand}
                disabled={!newCommand.trim() || !newOutput.trim()}
              >
                💾 Save to History
              </button>
            </div>
          </div>
        </div>
      )}

      {showTemplateModal && (
        <div className="modal-overlay" onClick={() => setShowTemplateModal(false)}>
          <div className="modal-content template-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Create Command Template</h2>
              <button className="close-btn" onClick={() => setShowTemplateModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Template Name</label>
                <input
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="e.g., Database Migration Check"
                />
              </div>
              <div className="form-group">
                <label>Command</label>
                <textarea
                  value={newTemplateCommand}
                  onChange={(e) => setNewTemplateCommand(e.target.value)}
                  placeholder="Enter the command that will be used when this template is clicked..."
                  rows="6"
                />
              </div>
              <div className="context-info">
                <span>📍 This template will be saved for: {selectedService}</span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowTemplateModal(false)}>
                Cancel
              </button>
              <button className="save-btn" onClick={saveTemplate}>
                Create Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
