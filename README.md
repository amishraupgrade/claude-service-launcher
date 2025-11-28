# Claude Service Launcher

A web-based UI for launching Claude Code CLI across multiple GitHub repositories with auto-discovery, branch selection, PR management, and smart features.

![Status](https://img.shields.io/badge/status-active-success)
![Node](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen)

## Features

### Core Features
- 🚀 **One-Click Launch** - Opens Terminal with Claude running in selected service directory
- 🔍 **Auto-Discovery** - Automatically finds active repos from GitHub organization (last 3 months)
- 🌿 **Branch & PR Management** - View and checkout any branch or open pull request
- 📊 **Real-time Status** - Live indicators for running Claude sessions, git status, uncommitted changes
- ⏰ **Recently Used** - Auto-sorted by last used with timestamps

### Advanced Features
- 📦 **Quick Actions** - Open in GitHub, VS Code, copy URL (hover over service cards)
- 🔔 **Smart Notifications** - Toast messages + desktop notifications
- ⚙️ **Configurable Settings** - Customize org name, cache duration, exclusion rules
- 🔎 **Smart Search** - Real-time filtering with keyboard shortcuts (Cmd+K)
- 📋 **Git Integration** - Shows branch status, ahead/behind, uncommitted changes

## Prerequisites

- **Node.js** v16+ and npm
- **Claude Code CLI** - Installed and authenticated with SSO
- **GitHub CLI (gh)** - Installed and authenticated
- **Git** - For repository management
- **macOS** - Terminal automation uses AppleScript

## Installation

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd claude-ui
```

### 2. Install Dependencies

```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd client && npm install && cd ..
```

### 3. Configure Services

Edit `services.json` to add your manual services (optional - auto-discovery works without this):

```json
{
  "services": [
    {
      "name": "my-service",
      "githubUrl": "git@github.com:YourOrg/my-service.git",
      "localPath": null
    }
  ],
  "cloneBaseDir": "/Users/yourname/projects/repos"
}
```

**Note:** `localPath` can be:
- `null` - Will clone to `cloneBaseDir/serviceName`
- Absolute path - Use existing local repo

## Usage

### Start the Application

```bash
npm run dev
```

This starts:
- Backend server: `http://localhost:3001`
- Frontend app: `http://localhost:3000` (opens automatically)

### First Launch

1. **Grant Permissions** - Allow desktop notifications when prompted
2. **Configure Settings** - Click ⚙️ Settings to customize:
   - GitHub organization name (default: Credify)
   - Cache duration in hours (default: 24)
   - Exclusion rules for unwanted repos

### Using the Launcher

1. **Browse Services** - Auto-discovered repos appear with "Auto" badge
2. **Search** - Type to filter, press Escape to clear
3. **Select Service** - Click on a service card
4. **Choose Branch/PR** - Select from dropdown (shows open PRs + all branches)
5. **Launch** - Click "Launch" button - Terminal opens automatically
6. **Quick Actions** - Hover over service cards for GitHub/VS Code/Copy actions

### Settings Configuration

Click **⚙️ Settings** to configure:

- **Organization Name** - GitHub org to fetch repos from
- **Cache Duration** - How long to cache repo list (1-168 hours)
- **Exclusions** - Comma-separated lists:
  - Starts with: `up-, artifactory`
  - Ends with: `-client, -lib, -model, -utils, -events, -workflows, -dags`
  - Contains: `terraform`

Settings are saved to `settings.json` and persist across restarts.

## Project Structure

```
claude-ui/
├── server/
│   └── index.js              # Backend API + repo management
├── client/
│   ├── public/
│   │   └── index.html
│   └── src/
│       ├── App.js            # Main React component
│       ├── App.css           # Styling
│       ├── Toast.js          # Toast notifications
│       ├── Toast.css
│       ├── Settings.js       # Settings modal
│       ├── Settings.css
│       └── index.js
├── services.json             # Manual service definitions
├── settings.json             # User settings (auto-generated)
├── recent-usage.json         # Usage tracking (auto-generated)
├── package.json              # Backend dependencies
└── README.md
```

## API Endpoints

### REST API

- `GET /api/services` - List all services (manual + auto-discovered)
- `GET /api/services/:name/status` - Get git status, running status
- `GET /api/services/:name/branches` - Get branches and open PRs
- `GET /api/settings` - Get current settings
- `POST /api/settings` - Update settings
- `POST /api/launch/:name` - Launch Terminal with Claude
- `DELETE /api/sessions/:name` - Clear session tracking

## Configuration Files

### services.json (Optional)
Manually define services that should always appear:

```json
{
  "services": [
    {
      "name": "service-name",
      "githubUrl": "git@github.com:Org/repo.git",
      "localPath": null
    }
  ],
  "cloneBaseDir": "/path/to/repos"
}
```

### settings.json (Auto-generated)
User preferences - managed through UI:

```json
{
  "orgName": "YourOrg",
  "cacheDuration": 24,
  "exclusions": {
    "startsWith": ["up-", "artifactory"],
    "endsWith": ["-client", "-lib"],
    "contains": ["terraform"]
  }
}
```

### recent-usage.json (Auto-generated)
Tracks when services were last launched.

## Troubleshooting

### Claude Code Not Found
```bash
which claude  # Verify installation
```

### GitHub CLI Not Authenticated
```bash
gh auth status
gh auth login  # If needed
```

### Port Already in Use
```bash
# Backend (3001)
PORT=3002 npm run server

# Frontend (3000)
# Create client/.env with: PORT=3005
```

### Permission Denied on Git Operations
- Ensure SSH keys are set up for GitHub
- Test: `ssh -T git@github.com`

### Repos Not Auto-Discovering
- Check GitHub CLI auth: `gh auth status`
- Verify org name in Settings
- Check server logs for errors

### Desktop Notifications Not Working
- Allow notifications when prompted
- Check browser notification settings
- macOS: System Settings → Notifications → [Your Browser]

## Development

### Run Backend Only
```bash
npm run server
```

### Run Frontend Only
```bash
npm run client
```

### Debug Mode
Check server logs for:
- Repo fetching: "Fetching active repos from..."
- PR loading: "Found X open PRs..."
- Launch events: "Starting Claude for..."

## Technology Stack

**Backend:**
- Node.js + Express
- simple-git (Git operations)
- node-pty (Terminal management)
- GitHub CLI (gh) integration

**Frontend:**
- React 18
- React Markdown (for PR descriptions)
- Custom CSS (VS Code-inspired theme)

## Security Notes

- No API keys stored in code
- Uses SSO authentication via Claude CLI
- GitHub auth via gh CLI
- All credentials managed by system tools

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT

## Acknowledgments

- Built for teams using Claude Code CLI with multiple microservices
- Designed to work with GitHub SSO authentication
- Inspired by VS Code's interface design
