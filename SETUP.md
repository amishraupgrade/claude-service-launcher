# Quick Setup Guide

## Step 1: Configure Your Services

Edit `services.json` to add your services. Replace the example entries with your actual services:

```json
{
  "services": [
    {
      "name": "auth-service",
      "githubUrl": "https://github.com/your-org/auth-service.git",
      "localPath": null
    },
    {
      "name": "payment-service",
      "githubUrl": "https://github.com/your-org/payment-service.git",
      "localPath": "/Users/amishra/services/payment-service"
    }
  ],
  "cloneBaseDir": "/Users/amishra/services/repos"
}
```

**Tips:**
- Set `localPath` to `null` if you want the service to be cloned automatically
- Set `localPath` to an absolute path if the service already exists locally
- The `cloneBaseDir` is where new services will be cloned

## Step 2: Install Dependencies

```bash
cd /Users/amishra/services/claude-ui
npm run install-all
```

This installs dependencies for both the backend and frontend.

## Step 3: Start the Application

```bash
npm run dev
```

Your browser should automatically open to http://localhost:3000

## Step 4: Use the Application

1. Select a service from the dropdown
2. Wait for the status to show "Ready" (green dot)
3. Start asking Claude questions about the service!

## Example Questions You Can Ask:

- "What does this service do?"
- "Explain the authentication flow"
- "Where are the API endpoints defined?"
- "How does error handling work?"
- "What dependencies does this project use?"
- "Help me debug the login issue"

## Common Issues

**"Claude Code not found"**
- Make sure Claude Code CLI is installed: `npm install -g @anthropic-ai/claude-code`
- Verify it's in your PATH: `which claude`

**"Cannot clone repository"**
- Verify GitHub URLs are correct
- Ensure you have SSH keys set up for GitHub
- Check you have access to the repositories

**"Port already in use"**
- Backend port 3001 is in use: `PORT=3002 npm run server`
- Frontend port 3000 is in use: Create `client/.env` with `PORT=3005`

## Need Help?

Check the full README.md for detailed documentation and troubleshooting.
