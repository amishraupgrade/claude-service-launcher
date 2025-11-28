const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const simpleGit = require('simple-git');

const execAsync = promisify(exec);

const app = express();
app.use(cors());
app.use(express.json());

const CONFIG_PATH = path.join(__dirname, '..', 'services.json');
const SETTINGS_PATH = path.join(__dirname, '..', 'settings.json');
const RECENT_USAGE_PATH = path.join(__dirname, '..', 'recent-usage.json');
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

async function ensureRepoReady(service, config, branch = null) {
  const targetDir = service.localPath || path.join(config.cloneBaseDir, service.name);

  try {
    await fs.access(targetDir);
    console.log(`[${service.name}] Pulling latest...`);
    const git = simpleGit(targetDir);

    if (branch) {
      await git.checkout(branch);
      console.log(`[${service.name}] Checked out branch: ${branch}`);
    }

    await git.fetch();
    await git.pull('origin', branch || 'master');
    return targetDir;
  } catch (error) {
    console.log(`[${service.name}] Cloning...`);
    const parentDir = path.dirname(targetDir);
    await fs.mkdir(parentDir, { recursive: true });
    const git = simpleGit();
    await git.clone(service.githubUrl, targetDir);

    if (branch && branch !== 'master') {
      const repoGit = simpleGit(targetDir);
      await repoGit.checkout(branch);
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

function openTerminal(workingDir, serviceName, branch) {
  const branchInfo = branch ? ` (${branch})` : '';
  const command = `cd "${workingDir}" && clear && echo "Starting Claude for ${serviceName}${branchInfo}..." && claude`;

  const appleScript = `
tell application "Terminal"
    do script "${command.replace(/"/g, '\\"')}"
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
    const { branch } = req.body;

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const workingDir = await ensureRepoReady(service, config, branch);
    openTerminal(workingDir, service.name, branch);

    // Track usage
    await saveRecentUsage(service.name);

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

app.listen(3001, () => {
  console.log('Server on http://localhost:3001');
});
