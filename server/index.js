const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const simpleGit = require('simple-git');

const execAsync = promisify(exec);

const app = express();
app.use(cors());
app.use(express.json());

const CONFIG_PATH = path.join(__dirname, '..', 'services.json');
const SETTINGS_PATH = path.join(__dirname, '..', 'settings.json');
const RECENT_USAGE_PATH = path.join(__dirname, '..', 'recent-usage.json');
const COMMAND_HISTORY_PATH = path.join(__dirname, '..', 'claude-command-history.json');
const COMMAND_TEMPLATES_PATH = path.join(__dirname, '..', 'command-templates.json');
const activeSessions = new Map(); // serviceName -> { pid, startTime, workingDir }

// Cache for active repos (TTL: 24 hours)
let cachedRepos = null;
let cacheTimestamp = null;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Settings cache
let settings = null;

async function loadConfig() {
  const data = await fs.readFile(CONFIG_PATH, 'utf8');
  return JSON.parse(data);
}

async function loadSettings() {
  if (settings) return settings;

  try {
    const data = await fs.readFile(SETTINGS_PATH, 'utf8');
    settings = JSON.parse(data);
  } catch (error) {
    // Default settings
    settings = {
      orgName: 'Credify',
      cacheDuration: 24,
      exclusions: {
        startsWith: ['up-', 'artifactory'],
        endsWith: ['-client', '-lib', '-model', '-utils', '-events', '-workflows', '-dags'],
        contains: ['terraform']
      }
    };
  }
  return settings;
}

async function saveSettings(newSettings) {
  settings = newSettings;
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  // Clear cache when settings change
  cachedRepos = null;
  cacheTimestamp = null;
}

async function loadRecentUsage() {
  try {
    const data = await fs.readFile(RECENT_USAGE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

async function saveRecentUsage(serviceName) {
  const usage = await loadRecentUsage();
  usage[serviceName] = Date.now();
  await fs.writeFile(RECENT_USAGE_PATH, JSON.stringify(usage, null, 2));
}

async function loadCommandHistory() {
  try {
    const data = await fs.readFile(COMMAND_HISTORY_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

async function saveCommandHistory(history) {
  await fs.writeFile(COMMAND_HISTORY_PATH, JSON.stringify(history, null, 2));
}

async function addCommandToHistory(serviceName, command, output, branch = null, prNumber = null) {
  const history = await loadCommandHistory();

  if (!history[serviceName]) {
    history[serviceName] = [];
  }

  const entry = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    command,
    output,
    branch,
    prNumber
  };

  // Add to beginning of array (most recent first)
  history[serviceName].unshift(entry);

  // Keep only last 10 commands per service
  history[serviceName] = history[serviceName].slice(0, 10);

  await saveCommandHistory(history);
  return entry;
}

async function getCommandHistory(serviceName, branch = null, prNumber = null) {
  const history = await loadCommandHistory();
  const serviceHistory = history[serviceName] || [];

  // If branch or PR specified, filter to show relevant commands
  if (branch || prNumber) {
    return serviceHistory.filter(cmd => {
      if (prNumber && cmd.prNumber === prNumber) return true;
      if (branch && cmd.branch === branch) return true;
      // Also show commands without branch/PR (general commands)
      if (!cmd.branch && !cmd.prNumber) return true;
      return false;
    });
  }

  return serviceHistory;
}

// Default command templates
const DEFAULT_TEMPLATES = {
  global: [
    { id: 'analyze-security', name: 'Analyze Security', command: 'Analyze this codebase for security vulnerabilities, focusing on authentication, authorization, input validation, and common OWASP issues.', category: 'security' },
    { id: 'review-code', name: 'Code Review', command: 'Review the code for best practices, potential bugs, performance issues, and maintainability. Provide specific suggestions.', category: 'review' },
    { id: 'explain-architecture', name: 'Explain Architecture', command: 'Explain the overall architecture of this service, including main components, data flow, and key design patterns used.', category: 'documentation' },
    { id: 'find-bugs', name: 'Find Bugs', command: 'Scan the codebase for potential bugs, edge cases, error handling issues, and race conditions.', category: 'debugging' },
    { id: 'optimize-performance', name: 'Optimize Performance', command: 'Identify performance bottlenecks, suggest optimizations for database queries, API calls, and computational efficiency.', category: 'performance' },
    { id: 'write-tests', name: 'Generate Tests', command: 'Generate comprehensive unit tests for the main functionality, covering edge cases and error scenarios.', category: 'testing' },
    { id: 'refactor-code', name: 'Refactor Code', command: 'Suggest refactoring opportunities to improve code quality, reduce duplication, and enhance readability.', category: 'refactoring' },
    { id: 'api-documentation', name: 'Document APIs', command: 'Generate API documentation including endpoints, request/response formats, authentication, and error codes.', category: 'documentation' }
  ]
};

async function loadCommandTemplates() {
  try {
    const data = await fs.readFile(COMMAND_TEMPLATES_PATH, 'utf8');
    const templates = JSON.parse(data);
    // Merge with default templates
    return {
      global: DEFAULT_TEMPLATES.global,
      ...templates
    };
  } catch (error) {
    // Return defaults if file doesn't exist
    return DEFAULT_TEMPLATES;
  }
}

async function saveCommandTemplates(templates) {
  // Don't save global templates, only custom per-service ones
  const { global, ...customTemplates } = templates;
  await fs.writeFile(COMMAND_TEMPLATES_PATH, JSON.stringify(customTemplates, null, 2));
}

async function getTemplatesForService(serviceName) {
  const allTemplates = await loadCommandTemplates();
  const global = allTemplates.global || [];
  const serviceTemplates = allTemplates[serviceName] || [];

  return {
    global,
    service: serviceTemplates
  };
}

async function addTemplateForService(serviceName, template) {
  const templates = await loadCommandTemplates();

  if (!templates[serviceName]) {
    templates[serviceName] = [];
  }

  const newTemplate = {
    id: Date.now().toString(),
    name: template.name,
    command: template.command,
    category: template.category || 'custom'
  };

  templates[serviceName].push(newTemplate);
  await saveCommandTemplates(templates);

  return newTemplate;
}

async function ensureRepoReady(service, config, branch = null) {
  const targetDir = service.localPath || path.join(config.cloneBaseDir, service.name);

  // Check if directory exists
  let dirExists = false;
  try {
    await fs.access(targetDir);
    dirExists = true;
  } catch (error) {
    dirExists = false;
  }

  if (dirExists) {
    // Directory exists - update the repo
    console.log(`[${service.name}] Repo exists, updating...`);
    const git = simpleGit(targetDir);

    try {
      // Fetch all branches first
      await git.fetch();
      console.log(`[${service.name}] Fetched latest changes`);

      if (branch) {
        // Try to checkout the branch
        try {
          await git.checkout(branch);
          console.log(`[${service.name}] Checked out branch: ${branch}`);
        } catch (checkoutError) {
          // Branch might not exist locally, try to create it from remote
          console.log(`[${service.name}] Branch not found locally, checking remote...`);
          await git.checkout(['-b', branch, `origin/${branch}`]);
          console.log(`[${service.name}] Created and checked out branch from remote: ${branch}`);
        }

        // Pull latest changes for the branch
        await git.pull('origin', branch);
        console.log(`[${service.name}] Pulled latest changes for ${branch}`);
      } else {
        // No specific branch, just pull current branch
        await git.pull();
        console.log(`[${service.name}] Pulled latest changes`);
      }

      return targetDir;
    } catch (gitError) {
      console.error(`[${service.name}] Git operation failed:`, gitError.message);
      // If git operations fail but directory exists, still return the directory
      // The user can manually fix any git issues
      return targetDir;
    }
  } else {
    // Directory doesn't exist - clone it
    console.log(`[${service.name}] Cloning...`);
    const parentDir = path.dirname(targetDir);
    await fs.mkdir(parentDir, { recursive: true });
    const git = simpleGit();
    await git.clone(service.githubUrl, targetDir);
    console.log(`[${service.name}] Cloned successfully`);

    if (branch && branch !== 'master' && branch !== 'main') {
      const repoGit = simpleGit(targetDir);
      await repoGit.checkout(branch);
      console.log(`[${service.name}] Checked out branch: ${branch}`);
    }

    return targetDir;
  }
}

async function getGitStatus(workingDir) {
  try {
    await fs.access(workingDir);
    const git = simpleGit(workingDir);

    const status = await git.status();
    const branches = await git.branch();

    return {
      exists: true,
      currentBranch: status.current,
      branches: branches.all,
      hasChanges: !status.isClean(),
      ahead: status.ahead,
      behind: status.behind,
      modified: status.modified.length,
      created: status.created.length,
      deleted: status.deleted.length
    };
  } catch (error) {
    return {
      exists: false,
      currentBranch: null,
      branches: [],
      hasChanges: false
    };
  }
}

async function isClaudeRunning(workingDir) {
  try {
    // Check if there's a claude process with this working directory
    const { stdout } = await execAsync(`lsof -c claude 2>/dev/null | grep "${workingDir}" || true`);
    return stdout.trim().length > 0;
  } catch (error) {
    return false;
  }
}

function openTerminalWithCommand(workingDir, serviceName, branch, claudeCommand, prNumber = null, prTitle = null) {
  // Build title with PR info if available
  let displayTitle;
  if (prNumber && prTitle) {
    const shortTitle = prTitle.length > 50 ? prTitle.substring(0, 47) + '...' : prTitle;
    displayTitle = `${serviceName} - PR #${prNumber}: ${shortTitle}`;
  } else if (branch) {
    displayTitle = `${serviceName} (${branch})`;
  } else {
    displayTitle = serviceName;
  }

  const uniqueId = `CLAUDE_SESSION_${serviceName}`;
  const fullTitle = `${uniqueId} | ${displayTitle}`;

  // Escape the Claude command for use in AppleScript
  const escapedClaudeCommand = claudeCommand
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');

  // Command to start Claude and then send the prompt
  const command = `cd "${workingDir}" && clear && claude`;
  const escapedCommand = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedTitle = fullTitle.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const appleScript = `
tell application "Terminal"
    set newTab to do script "${escapedCommand}"
    set custom title of newTab to "${escapedTitle}"
    activate
    delay 2
    tell application "System Events"
        keystroke "${escapedClaudeCommand}"
        delay 0.3
        keystroke return
    end tell
end tell
  `.trim();

  const tempFile = path.join('/tmp', `launch-cmd-${Date.now()}.scpt`);

  fs.writeFile(tempFile, appleScript)
    .then(() => {
      exec(`osascript "${tempFile}"`, (error, stdout) => {
        fs.unlink(tempFile).catch(() => {});
        if (error) {
          console.error('Error opening terminal with command:', error);
        } else {
          activeSessions.set(serviceName, {
            startTime: Date.now(),
            workingDir,
            branch: branch || 'master'
          });
        }
      });
    })
    .catch(err => console.error('Error writing script:', err));
}

function openTerminal(workingDir, serviceName, branch, prNumber = null, prTitle = null) {
  // Build title with PR info if available
  let displayTitle;
  if (prNumber && prTitle) {
    // Truncate PR title if too long
    const shortTitle = prTitle.length > 50 ? prTitle.substring(0, 47) + '...' : prTitle;
    displayTitle = `${serviceName} - PR #${prNumber}: ${shortTitle}`;
  } else if (branch) {
    displayTitle = `${serviceName} (${branch})`;
  } else {
    displayTitle = serviceName;
  }

  // Keep the unique identifier for session tracking
  const uniqueId = `CLAUDE_SESSION_${serviceName}`;

  // Combine both: unique ID for tracking + display title for visibility
  const fullTitle = `${uniqueId} | ${displayTitle}`;

  // Simple command without echo to avoid escaping issues
  const command = `cd "${workingDir}" && clear && claude`;

  // Escape for AppleScript - only need to escape backslashes and double quotes
  const escapedCommand = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedTitle = fullTitle.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const appleScript = `
tell application "Terminal"
    set newTab to do script "${escapedCommand}"
    set custom title of newTab to "${escapedTitle}"
    activate
end tell
  `.trim();

  const tempFile = path.join('/tmp', `launch-${Date.now()}.scpt`);

  fs.writeFile(tempFile, appleScript)
    .then(() => {
      exec(`osascript "${tempFile}"`, (error, stdout) => {
        fs.unlink(tempFile).catch(() => {});
        if (error) {
          console.error('Error opening terminal:', error);
        } else {
          activeSessions.set(serviceName, {
            startTime: Date.now(),
            workingDir,
            branch: branch || 'master'
          });
        }
      });
    })
    .catch(err => console.error('Error writing script:', err));
}

async function openQaAutomationTerminal(prUrl, envName, config) {
  const qaAutomationDir = path.join(config.cloneBaseDir, 'qa-automation');

  console.log('='.repeat(60));
  console.log('QA AUTOMATION TERMINAL LAUNCH');
  console.log('='.repeat(60));
  console.log(`PR URL: ${prUrl}`);
  console.log(`Environment: ${envName}`);
  console.log(`Target Directory: ${qaAutomationDir}`);
  console.log('='.repeat(60));

  try {
    // Ensure qa-automation repo exists
    let dirExists = false;

    // Check if directory exists
    try {
      await fs.access(qaAutomationDir);
      dirExists = true;
    } catch (error) {
      dirExists = false;
    }

    if (dirExists) {
      // Directory exists - try to update it
      console.log('[qa-automation] ✓ Repo exists, pulling latest changes...');
      const git = simpleGit(qaAutomationDir);

      try {
        // Check if it's a valid git repo
        const isRepo = await git.checkIsRepo();
        if (isRepo) {
          await git.fetch();
          await git.pull('origin', 'master');
          console.log('[qa-automation] ✓ Repository updated successfully');
        } else {
          console.log('[qa-automation] ⚠ Directory exists but is not a git repo, using as-is');
        }
      } catch (pullError) {
        console.log('[qa-automation] ⚠ Failed to pull latest changes, using existing repo:', pullError.message);
      }
    } else {
      // Directory doesn't exist - clone it
      console.log('[qa-automation] ⚠ Repo not found, cloning qa-automation...');
      const parentDir = path.dirname(qaAutomationDir);
      await fs.mkdir(parentDir, { recursive: true });
      const git = simpleGit();
      await git.clone('git@github.com:Credify/qa-automation.git', qaAutomationDir);
      console.log('[qa-automation] ✓ Repository cloned successfully');
    }

    // Build the command with permissions skipped
    const claudeCommand = `/analyze-srvc-pr ${prUrl} --run-tests ${envName}`;
    const startCommand = `cd "${qaAutomationDir}" && clear && echo "🤖 Starting Claude for QA Automation (skip permissions)..." && echo "PR: ${prUrl}" && echo "Environment: ${envName}" && echo "" && echo "Command to execute: ${claudeCommand}" && echo "" && claude --dangerously-skip-permissions`;

    console.log('[qa-automation] Command to execute in Claude:');
    console.log(`  ${claudeCommand}`);

    // AppleScript that opens Claude and then sends keystrokes to execute the command
    const appleScript = `
tell application "Terminal"
    set newTab to do script "${startCommand.replace(/"/g, '\\"')}"
    activate
    delay 3
    tell application "System Events"
        keystroke "${claudeCommand.replace(/"/g, '\\"')}"
        delay 0.5
        keystroke return
    end tell
end tell
    `.trim();

    const tempFile = path.join('/tmp', `qa-launch-${Date.now()}.scpt`);

    await fs.writeFile(tempFile, appleScript);
    console.log('[qa-automation] ✓ AppleScript created, launching terminal...');

    exec(`osascript "${tempFile}"`, (error, stdout) => {
      fs.unlink(tempFile).catch(() => {});
      if (error) {
        console.error('[qa-automation] ✗ Error opening terminal:', error);
      } else {
        console.log('[qa-automation] ✓ Terminal opened and activated successfully');
        console.log('='.repeat(60));
      }
    });
  } catch (error) {
    console.error('[qa-automation] ✗ Error in openQaAutomationTerminal:', error);
    console.log('='.repeat(60));
    throw error;
  }
}

async function getActiveRepos() {
  // Return cached data if still valid
  const config = await loadSettings();
  const cacheDuration = (config.cacheDuration || 24) * 60 * 60 * 1000;

  if (cachedRepos && cacheTimestamp && (Date.now() - cacheTimestamp < cacheDuration)) {
    return cachedRepos;
  }

  try {
    const orgName = config.orgName || 'Credify';
    const exclusions = config.exclusions || {};
    console.log(`Fetching active repos from ${orgName}...`);

    const { stdout } = await execAsync(
      `gh repo list ${orgName} --json name,pushedAt,sshUrl,nameWithOwner --limit 1000`
    );

    const repos = JSON.parse(stdout);
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    // Filter repos with activity in last 3 months and apply exclusions
    const activeRepos = repos
      .filter(repo => {
        // Check if active in last 3 months
        if (new Date(repo.pushedAt) <= threeMonthsAgo) return false;

        const name = repo.name.toLowerCase();

        // Apply exclusion rules from settings
        if (exclusions.startsWith) {
          for (const prefix of exclusions.startsWith) {
            if (name.startsWith(prefix.toLowerCase())) return false;
          }
        }

        if (exclusions.contains) {
          for (const keyword of exclusions.contains) {
            if (name.includes(keyword.toLowerCase())) return false;
          }
        }

        if (exclusions.endsWith) {
          for (const suffix of exclusions.endsWith) {
            if (name.endsWith(suffix.toLowerCase())) return false;
          }
        }

        return true;
      })
      .map(repo => ({
        name: repo.name,
        githubUrl: repo.sshUrl,
        localPath: null,
        lastPushed: repo.pushedAt,
        isAutoDiscovered: true
      }))
      .sort((a, b) => new Date(b.lastPushed) - new Date(a.lastPushed));

    console.log(`Found ${activeRepos.length} active repos in ${orgName}`);

    // Cache the results
    cachedRepos = activeRepos;
    cacheTimestamp = Date.now();

    return activeRepos;
  } catch (error) {
    console.error('Error fetching active repos:', error.message);
    return [];
  }
}

async function getAllServices() {
  const config = await loadConfig();
  const manualServices = config.services || [];

  // Get active repos from GitHub
  const activeRepos = await getActiveRepos();

  // Merge manual and auto-discovered, avoiding duplicates
  const manualServiceNames = new Set(manualServices.map(s => s.name));
  const uniqueActiveRepos = activeRepos.filter(repo => !manualServiceNames.has(repo.name));

  const allServices = [...manualServices, ...uniqueActiveRepos];

  // Add recent usage data
  const recentUsage = await loadRecentUsage();
  return allServices.map(service => ({
    ...service,
    lastUsed: recentUsage[service.name] || null
  })).sort((a, b) => {
    // Sort by recent usage (most recent first)
    if (a.lastUsed && b.lastUsed) return b.lastUsed - a.lastUsed;
    if (a.lastUsed) return -1;
    if (b.lastUsed) return 1;
    return 0;
  });
}

app.get('/api/services', async (req, res) => {
  try {
    const allServices = await getAllServices();
    res.json(allServices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/services/:serviceName/status', async (req, res) => {
  try {
    const config = await loadConfig();
    const allServices = await getAllServices();
    const service = allServices.find(s => s.name === req.params.serviceName);

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const targetDir = service.localPath || path.join(config.cloneBaseDir, service.name);
    const gitStatus = await getGitStatus(targetDir);
    const hasActiveSession = activeSessions.has(service.name);
    const isRunning = gitStatus.exists ? await isClaudeRunning(targetDir) : false;

    res.json({
      ...gitStatus,
      hasActiveSession,
      isRunning,
      sessionInfo: activeSessions.get(service.name)
    });
  } catch (error) {
    console.error(`Error getting status for ${req.params.serviceName}:`, error.message);
    // Return a default status instead of 500
    res.json({
      exists: false,
      currentBranch: null,
      branches: [],
      hasChanges: false,
      hasActiveSession: false,
      isRunning: false
    });
  }
});

async function getGitHubPRs(githubUrl) {
  try {
    // Parse GitHub URL to get owner and repo
    const match = githubUrl.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
    if (!match) {
      console.log('Could not parse GitHub URL:', githubUrl);
      return [];
    }

    const [, owner, repo] = match;
    const repoFullName = `${owner}/${repo.replace(/\.git$/, '')}`;

    console.log(`Fetching PRs for: ${repoFullName}`);

    // Use gh CLI to get PRs
    const { stdout } = await execAsync(
      `gh pr list --repo ${repoFullName} --json number,title,headRefName,author --limit 100`
    );

    const prs = JSON.parse(stdout);
    console.log(`Found ${prs.length} open PRs for ${repoFullName}`);

    return prs.map(pr => ({
      branch: pr.headRefName,
      title: pr.title,
      number: pr.number,
      author: pr.author.login,
      isPR: true
    }));
  } catch (error) {
    console.error('Error fetching PRs:', error.message);
    return [];
  }
}

app.get('/api/services/:serviceName/branches', async (req, res) => {
  try {
    const config = await loadConfig();
    const allServices = await getAllServices();
    const service = allServices.find(s => s.name === req.params.serviceName);

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const targetDir = service.localPath || path.join(config.cloneBaseDir, service.name);

    try {
      await fs.access(targetDir);
      const git = simpleGit(targetDir);

      // Fetch latest from remote
      await git.fetch();

      const branches = await git.branch(['-a']);

      // Get local and remote branches
      const localBranches = branches.all.filter(b => !b.startsWith('remotes/'));
      const remoteBranches = branches.all
        .filter(b => b.startsWith('remotes/origin/'))
        .map(b => b.replace('remotes/origin/', ''))
        .filter(b => b !== 'HEAD');

      // Combine and deduplicate
      const allBranches = [...new Set([...localBranches, ...remoteBranches])];

      // Get PRs
      const prs = await getGitHubPRs(service.githubUrl);

      res.json({
        current: branches.current,
        all: allBranches,
        prs: prs
      });
    } catch (error) {
      // If repo doesn't exist, still try to get PRs
      const prs = await getGitHubPRs(service.githubUrl);
      res.json({ current: null, all: [], prs: prs });
    }
  } catch (error) {
    console.error(`Error getting branches for ${req.params.serviceName}:`, error.message);
    // Return empty data instead of 500
    res.json({ current: null, all: [], prs: [] });
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    const settings = await loadSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    await saveSettings(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/launch/:serviceName', async (req, res) => {
  try {
    const config = await loadConfig();
    const allServices = await getAllServices();
    const service = allServices.find(s => s.name === req.params.serviceName);
    const { branch, runQaAutomation, qaEnvironment, prNumber, prTitle, claudeCommand } = req.body;

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const workingDir = await ensureRepoReady(service, config, branch);

    // If claudeCommand is provided, use the command version
    if (claudeCommand) {
      openTerminalWithCommand(workingDir, service.name, branch, claudeCommand, prNumber, prTitle);
    } else {
      openTerminal(workingDir, service.name, branch, prNumber, prTitle);
    }

    // Track usage
    await saveRecentUsage(service.name);

    // If qa-automation is enabled and we have a PR, open the second terminal
    if (runQaAutomation && prNumber) {
      // Construct the PR URL from the service's GitHub URL
      const match = service.githubUrl.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
      if (match) {
        const [, owner, repo] = match;
        const repoName = repo.replace(/\.git$/, '');
        const prUrl = `https://github.com/${owner}/${repoName}/pull/${prNumber}`;

        console.log(`Opening QA automation terminal for PR: ${prUrl}, env: ${qaEnvironment || 'default'}`);

        try {
          await openQaAutomationTerminal(prUrl, qaEnvironment || 'dev', config);
        } catch (qaError) {
          console.error('Error opening QA automation terminal:', qaError);
          // Don't fail the whole request if QA automation fails
        }
      }
    }

    res.json({
      success: true,
      message: `Terminal opened for ${service.name}`,
      path: workingDir,
      branch: branch || 'master'
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/sessions/:serviceName', (req, res) => {
  activeSessions.delete(req.params.serviceName);
  res.json({ success: true });
});

// Command templates endpoints
app.get('/api/services/:serviceName/templates', async (req, res) => {
  try {
    const { serviceName } = req.params;
    const templates = await getTemplatesForService(serviceName);
    res.json(templates);
  } catch (error) {
    console.error('Error getting templates:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/services/:serviceName/templates', async (req, res) => {
  try {
    const { serviceName } = req.params;
    const { name, command, category } = req.body;

    if (!name || !command) {
      return res.status(400).json({ error: 'Name and command are required' });
    }

    const template = await addTemplateForService(serviceName, { name, command, category });
    res.json({ success: true, template });
  } catch (error) {
    console.error('Error adding template:', error);
    res.status(500).json({ error: error.message });
  }
});

// Command history endpoints
app.get('/api/services/:serviceName/commands', async (req, res) => {
  try {
    const { serviceName } = req.params;
    const { branch, prNumber } = req.query;
    const commands = await getCommandHistory(serviceName, branch, prNumber ? parseInt(prNumber) : null);
    res.json(commands);
  } catch (error) {
    console.error('Error getting command history:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/services/:serviceName/commands', async (req, res) => {
  try {
    const { serviceName } = req.params;
    const { command, output, branch, prNumber } = req.body;

    if (!command || !output) {
      return res.status(400).json({ error: 'Command and output are required' });
    }

    const entry = await addCommandToHistory(serviceName, command, output, branch, prNumber);
    res.json({ success: true, entry });
  } catch (error) {
    console.error('Error saving command:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sessions/:serviceName/attach', (req, res) => {
  const serviceName = req.params.serviceName;
  const sessionInfo = activeSessions.get(serviceName);

  if (!sessionInfo) {
    return res.status(404).json({ error: 'No active session found' });
  }

  // Find and activate the existing terminal window
  const { workingDir, branch } = sessionInfo;
  const uniqueId = `CLAUDE_SESSION_${serviceName}`;

  // AppleScript to find terminal by checking if title starts with the unique ID
  const appleScript = `
tell application "Terminal"
    activate
    set targetId to "${uniqueId}"
    set foundTab to false

    repeat with w in windows
        repeat with t in tabs of w
            try
                tell t
                    set tabTitle to custom title
                    set tabName to name
                end tell

                -- Check if custom title starts with our unique ID
                if tabTitle starts with targetId then
                    set frontmost of w to true
                    set selected of t to true
                    set index of w to 1
                    set foundTab to true
                    exit repeat
                end if

                -- Also check the name property
                if tabName contains targetId then
                    set frontmost of w to true
                    set selected of t to true
                    set index of w to 1
                    set foundTab to true
                    exit repeat
                end if
            on error errMsg
                -- Skip tabs where we can't check
            end try
        end repeat
        if foundTab then exit repeat
    end repeat

    if not foundTab then
        display notification "Could not find the terminal window. It may have been closed." with title "Session Not Found"
    end if
end tell
  `.trim();

  const tempFile = path.join('/tmp', `attach-${Date.now()}.scpt`);

  fs.writeFile(tempFile, appleScript)
    .then(() => {
      exec(`osascript "${tempFile}"`, (error, stdout) => {
        fs.unlink(tempFile).catch(() => {});
        if (error) {
          console.error('Error activating terminal:', error);
          return res.status(500).json({ error: 'Failed to activate terminal' });
        }
        res.json({
          success: true,
          message: `Switched to ${serviceName} session`,
          workingDir,
          branch
        });
      });
    })
    .catch(err => {
      console.error('Error writing script:', err);
      res.status(500).json({ error: 'Failed to create activation script' });
    });
});

// Knowledge Base API
const KB_DATA_PATH = path.join(__dirname, '..', '..', 'knowledge-base', 'data');

app.get('/api/knowledge-base/index', async (req, res) => {
  try {
    const indexPath = path.join(KB_DATA_PATH, 'index.json');
    const data = await fs.readFile(indexPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    console.error('Error loading knowledge base index:', error);
    res.status(404).json({ error: 'Knowledge base not found. Run update.sh first.' });
  }
});

app.get('/api/knowledge-base/service/:serviceName', async (req, res) => {
  try {
    const { serviceName } = req.params;
    const servicePath = path.join(KB_DATA_PATH, `${serviceName}.json`);
    const data = await fs.readFile(servicePath, 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    console.error(`Error loading service ${req.params.serviceName}:`, error);
    res.status(404).json({ error: 'Service documentation not found' });
  }
});

app.get('/api/knowledge-base/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const categoryPath = path.join(KB_DATA_PATH, `${category}.json`);
    const data = await fs.readFile(categoryPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    console.error(`Error loading category ${req.params.category}:`, error);
    res.status(404).json({ error: 'Category not found' });
  }
});

app.get('/api/knowledge-base/service/:serviceName/functional', async (req, res) => {
  try {
    const { serviceName } = req.params;
    const functionalPath = path.join(KB_DATA_PATH, `${serviceName}-functional.json`);
    const data = await fs.readFile(functionalPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    console.error(`Error loading functional docs for ${req.params.serviceName}:`, error);
    res.status(404).json({ error: 'Functional documentation not found' });
  }
});

app.get('/api/knowledge-base/service/:serviceName/ai', async (req, res) => {
  try {
    const { serviceName } = req.params;
    const aiPath = path.join(KB_DATA_PATH, `${serviceName}-ai.json`);
    const data = await fs.readFile(aiPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(404).json({ error: 'AI summary not available' });
  }
});

app.get('/api/knowledge-base/service/:serviceName/test', async (req, res) => {
  try {
    const { serviceName } = req.params;
    const testPath = path.join(KB_DATA_PATH, `${serviceName}-test.json`);
    const data = await fs.readFile(testPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(404).json({ error: 'Test analysis not available' });
  }
});

app.get('/api/knowledge-base/service/:serviceName/sequence', async (req, res) => {
  try {
    const { serviceName } = req.params;
    const sequencePath = path.join(KB_DATA_PATH, `${serviceName}-sequence.json`);
    const data = await fs.readFile(sequencePath, 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(404).json({ error: 'Sequence diagrams not available' });
  }
});

app.get('/api/knowledge-base/dependency-graph', async (req, res) => {
  try {
    const graphPath = path.join(KB_DATA_PATH, 'dependency-graph.json');
    const data = await fs.readFile(graphPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(404).json({ error: 'Dependency graph not available' });
  }
});

app.get('/api/knowledge-base/service/:serviceName/graphql', async (req, res) => {
  try {
    const { serviceName } = req.params;
    const graphqlPath = path.join(KB_DATA_PATH, `${serviceName}-graphql.json`);
    const data = await fs.readFile(graphqlPath, 'utf8');
    const graphqlData = JSON.parse(data);

    // Load cached descriptions
    const descriptionsPath = path.join(KB_DATA_PATH, `${serviceName}-descriptions.json`);
    let cachedDescriptions = {};
    try {
      const descData = await fs.readFile(descriptionsPath, 'utf8');
      cachedDescriptions = JSON.parse(descData);
    } catch (e) {
      // No cached descriptions yet
    }

    // Merge cached descriptions into queries/mutations
    if (graphqlData.queries) {
      graphqlData.queries = graphqlData.queries.map(q => ({
        ...q,
        description: q.description || cachedDescriptions[`query:${q.name}`]
      }));
    }

    if (graphqlData.mutations) {
      graphqlData.mutations = graphqlData.mutations.map(m => ({
        ...m,
        description: m.description || cachedDescriptions[`mutation:${m.name}`]
      }));
    }

    res.json(graphqlData);
  } catch (error) {
    res.status(404).json({ error: 'GraphQL documentation not available' });
  }
});

app.get('/api/knowledge-base/service/:serviceName/description-cache', async (req, res) => {
  try {
    const { serviceName } = req.params;
    const descriptionsPath = path.join(KB_DATA_PATH, `${serviceName}-descriptions.json`);
    const data = await fs.readFile(descriptionsPath, 'utf8');
    const cache = JSON.parse(data);

    // Filter out timestamp entries, return only descriptions
    const cleanCache = {};
    for (const [key, value] of Object.entries(cache)) {
      if (!key.endsWith(':timestamp')) {
        cleanCache[key] = value;
      }
    }

    res.json(cleanCache);
  } catch (error) {
    // No cache yet, return empty object
    res.json({});
  }
});

app.post('/api/knowledge-base/service/:serviceName/generate-ai-section', async (req, res) => {
  try {
    const { serviceName } = req.params;
    const { sectionType, serviceData, functionalData } = req.body;

    // Get the service repository path
    const serviceRepoPath = path.join(__dirname, '..', '..', 'repos', serviceName);

    // Check if CLAUDE.md exists
    const claudeMdPath = path.join(serviceRepoPath, 'CLAUDE.md');
    let hasClaudeMd = false;
    try {
      await fs.access(claudeMdPath);
      hasClaudeMd = true;
    } catch (e) {
      // No CLAUDE.md
    }

    let prompt;

    if (sectionType === 'executive-summary') {
      const topCapabilities = functionalData.businessCapabilities?.slice(0, 6) || [];

      prompt = `${hasClaudeMd ? `This service has a CLAUDE.md file at the root. Read it first to understand the service context.\n\n` : ''}The service repository is located at: ${serviceRepoPath}

Analyze the ${serviceData.name} service and write a 2-3 sentence executive summary for business stakeholders.

METRICS:
- ${serviceData.totalQueries} GraphQL queries, ${serviceData.totalMutations} mutations
- ${serviceData.totalMethods} service methods
- Purpose: ${functionalData.purpose}

TOP CAPABILITIES:
${topCapabilities.map(c => `- ${c}`).join('\n')}

${hasClaudeMd ? 'Read the CLAUDE.md file and any README to understand business context.' : 'Look at the GraphQL schema files and service classes to understand business context.'}

Write 2-3 SHORT sentences:
1. What business problem this solves
2. Main capabilities for users
3. Key business outcome

NO jargon. Explain to a product manager.
Return ONLY 2-3 sentences.`;
    } else if (sectionType === 'technical-deep-dive') {
      const featureDomains = functionalData.keyFeatures?.map(f => f.domain).slice(0, 6) || [];

      prompt = `Repository: ${serviceRepoPath}
${hasClaudeMd ? 'Read CLAUDE.md for service context and shared instructions.' : ''}

Analyze ${serviceData.name} by exploring the actual codebase.

QUICK METRICS:
- ${serviceData.totalQueries} queries, ${serviceData.totalMutations} mutations
- ${serviceData.totalMethods} methods, ${serviceData.totalEntities} entities
- Domains: ${featureDomains.join(', ')}

Check:
1. pom.xml for dependencies and tech stack
2. GraphQL schema files for API design
3. Package structure for architecture patterns
4. Service classes for business logic organization

Write 4-5 SHORT bullets (ONE LINE each):
• **Tech Stack**: [From pom.xml - actual libraries used]
• **Architecture**: [From package structure - actual pattern]
• **Data**: [From entities/repositories - actual persistence]
• **Integration**: [From dependencies - actual service calls]
• **Unique**: [ONE specific detail about THIS service from code]

Return ONLY bullets with • symbol. Be specific, not generic.`;
    }

    // Call Claude CLI with repository access
    const description = await new Promise((resolve, reject) => {
      // Give Claude access to the service repository
      const claudeArgs = [
        '--print',
        '--output-format', 'text',
        '--add-dir', serviceRepoPath
      ];

      const claude = spawn('claude', claudeArgs);

      let stdout = '';
      let stderr = '';

      claude.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      claude.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      claude.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        }
      });

      claude.on('error', (err) => {
        reject(err);
      });

      claude.stdin.write(prompt);
      claude.stdin.end();

      setTimeout(() => {
        claude.kill();
        reject(new Error('Claude CLI timeout after 180s'));
      }, 180000);  // 3 minutes for complex analysis with file access
    });

    const cleanDescription = description.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');

    // Save to cache
    const descriptionsPath = path.join(KB_DATA_PATH, `${serviceName}-descriptions.json`);
    let cachedDescriptions = {};
    try {
      const existing = await fs.readFile(descriptionsPath, 'utf8');
      cachedDescriptions = JSON.parse(existing);
    } catch (e) {
      // No cache yet
    }

    const cacheKey = `ai-section:${sectionType}`;
    cachedDescriptions[cacheKey] = cleanDescription;
    cachedDescriptions[`${cacheKey}:timestamp`] = Date.now();

    await fs.writeFile(descriptionsPath, JSON.stringify(cachedDescriptions, null, 2));

    console.log(`✓ Generated AI section: ${sectionType}`);

    res.json({
      success: true,
      description: cleanDescription,
      cached: true
    });

  } catch (error) {
    console.error('Error generating AI section:', error);
    res.status(500).json({ error: 'Failed to generate AI section', details: error.message });
  }
});

app.post('/api/knowledge-base/service/:serviceName/generate-description', async (req, res) => {
  try {
    const { serviceName } = req.params;
    const { type, name, signature, returnType, arguments: args, context } = req.body;

    // Get the service repository path
    const serviceRepoPath = path.join(__dirname, '..', '..', 'repos', serviceName);

    // Check if CLAUDE.md exists
    const claudeMdPath = path.join(serviceRepoPath, 'CLAUDE.md');
    let hasClaudeMd = false;
    try {
      await fs.access(claudeMdPath);
      hasClaudeMd = true;
    } catch (e) {
      // No CLAUDE.md
    }

    let prompt;

    if (type === 'query' || type === 'mutation') {
      // GraphQL query/mutation
      const argsList = args ? args.map(a => `${a.name}: ${a.type}`).join(', ') : '';
      const fullSignature = `${name}(${argsList}): ${returnType}`;

      prompt = `Repository: ${serviceRepoPath}
${hasClaudeMd ? 'Read CLAUDE.md for context.\n' : ''}
Analyze GraphQL ${type}: ${fullSignature}

Find the GraphQL schema file defining this ${type} and read its documentation comments.
Check the resolver implementation to understand business logic.

Write 2-3 sentences:
1. What it does (from schema comments and resolver)
2. Key parameters and their purpose
3. Return data and use cases

Be specific based on actual code. Return ONLY description text.`;
    } else if (type === 'feature-domain') {
      // Feature domain
      const capabilities = context?.capabilities || [];
      const servicePurpose = context?.servicePurpose || '';

      prompt = `Repository: ${serviceRepoPath}
${hasClaudeMd ? 'Read CLAUDE.md for business context.\n' : ''}
Domain: ${name}

These capabilities exist in this domain:
${capabilities.slice(0, 10).map(c => `- ${c}`).join('\n')}

Search the codebase for classes/files related to "${name}" (e.g., ${name}Service, ${name}Controller).
Read 2-3 key files to understand what this domain does.

Write 2-3 sentences explaining:
1. Business problem this domain solves
2. How capabilities work together
3. Key workflow or pattern used

Be specific based on actual code. Return ONLY explanation text.`;
    } else if (type === 'service-method') {
      // Service method
      const className = context?.className || '';
      const parameters = context?.parameters || [];
      const relatedMethods = context?.relatedMethods || [];

      prompt = `Repository: ${serviceRepoPath}

Find and read ${className}.java (search for it in the repository).

METHOD: ${className}.${name}(${parameters.join(', ')})
RETURNS: ${returnType}

Read the method implementation and write 2 SHORT sentences:
1. What business operation it performs
2. Inputs, return value, key side effects

Be specific from actual code. Return ONLY 2 sentences.`;
    }

    // Call Claude CLI with repository access
    const description = await new Promise((resolve, reject) => {
      const claudeArgs = ['--print', '--output-format', 'text', '--add-dir', serviceRepoPath];
      const claude = spawn('claude', claudeArgs);

      let stdout = '';
      let stderr = '';

      claude.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      claude.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      claude.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        }
      });

      claude.on('error', (err) => {
        reject(err);
      });

      // Write prompt to stdin
      claude.stdin.write(prompt);
      claude.stdin.end();

      // Timeout after 45 seconds
      setTimeout(() => {
        claude.kill();
        reject(new Error('Claude CLI timeout'));
      }, 45000);
    });

    // Remove ANSI codes
    const cleanDescription = description.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');

    // Save to cache
    const descriptionsPath = path.join(KB_DATA_PATH, `${serviceName}-descriptions.json`);
    let cachedDescriptions = {};
    try {
      const existing = await fs.readFile(descriptionsPath, 'utf8');
      cachedDescriptions = JSON.parse(existing);
    } catch (e) {
      // No cache yet
    }

    // Create consistent cache key
    let cacheKey;
    if (type === 'service-method') {
      const className = context?.className || '';
      cacheKey = `${type}:${className}.${name}`;
    } else {
      cacheKey = `${type}:${name}`;
    }

    cachedDescriptions[cacheKey] = cleanDescription;
    cachedDescriptions[`${cacheKey}:timestamp`] = Date.now();

    await fs.writeFile(descriptionsPath, JSON.stringify(cachedDescriptions, null, 2));

    console.log(`✓ Generated and cached description for ${cacheKey}`);

    res.json({
      success: true,
      description: cleanDescription,
      cached: true,
      cacheKey: cacheKey  // Return the key for debugging
    });

  } catch (error) {
    console.error('Error generating description:', error);
    console.error('Error details:', {
      type: req.body.type,
      name: req.body.name,
      errorMessage: error.message,
      errorStack: error.stack
    });
    res.status(500).json({
      error: 'Failed to generate description',
      details: error.message,
      type: req.body.type,
      name: req.body.name
    });
  }
});

app.listen(3001, () => {
  console.log('Server on http://localhost:3001');
});
