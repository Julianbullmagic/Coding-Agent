# Coding Agent Extension

A Visual Studio Code coding assistant with DeepSeek web search, SearXNG browsing, persistent conversations, Git/GitHub operations, and shell command execution so it can build and test the software it writes.

## Run locally

1. Install dependencies with `npm install`.
2. Compile with `npm run compile`.
3. Press **F5** in VS Code to open an Extension Development Host.
4. In the new window, run **Coding Agent: Set DeepSeek API Key** from the Command Palette.
5. Run **Coding Agent: Ask DeepSeek**, enter a prompt, and view the response in a Markdown editor.

The API key is stored using VS Code SecretStorage and is not written to project files. Conversations persist for each opened workspace. The extension uses DeepSeek's Responses API with the `deepseek-v4-pro` model, built-in web search, SearXNG, and workspace file tools. It can create and edit files, run shell commands, initialize Git repositories, create GitHub repositories through `gh`, commit workspace changes, and push branches without approval prompts. GitHub operations require Git and an authenticated GitHub CLI session; credentials are never stored in extension files.

## Running commands

The agent can run shell commands in the opened workspace to install dependencies, build, and run tests, so it can verify the software it creates against the real toolchain. Commands execute in the workspace directory through `cmd.exe` (Windows) or `/bin/sh` (macOS/Linux), with a configurable timeout and output cap. Treat the agent like any other local process: it runs with your user's permissions and can execute arbitrary commands in the workspace, so verify what it does before trusting the results.

By default, the extension starts the bundled SearXNG container when VS Code finishes starting. On Windows, it installs Docker Desktop with `winget` if Docker is missing, launches it when needed, waits for the engine, and starts the container. Windows may require Docker's first-run setup or a restart. The container binds only to `127.0.0.1:8080`; its generated secret is stored with VS Code SecretStorage. Disable `codingAgent.autoStartSearxng` to turn auto-start off or `codingAgent.autoInstallDocker` to prevent automatic installation. Set `codingAgent.searxngBaseUrl` to use another instance; auto-start applies only to the bundled local service. The included SearXNG settings enable JSON search. You can still use DeepSeek's built-in web search if SearXNG is unavailable. Web Search/Fetch requests may incur DeepSeek API charges; check DeepSeek's current pricing.

## GitHub sign-in status

The extension shows a **status-bar indicator** (bottom of the window) with your current GitHub login state:

- `GitHub: <your-login>` — signed in.
- `GitHub: Not signed in` — no credentials yet.
- `GitHub: sign-in expired` — credentials were previously stored but are now invalid/revoked.
- `GitHub: CLI not installed` — the GitHub CLI (`gh`) is not installed.

When credentials are missing or expired, the extension prompts you to sign in (via the
GitHub CLI device/web flow, which stores the credentials in the GitHub CLI's own credential
store — never in extension files). Clicking the status-bar item also starts sign-in. You can
disable the automatic prompt with `codingAgent.promptForGitHubLogin` (the indicator remains).

## Automatic GitHub backup

The extension can automatically back up the current workspace to GitHub. When enabled, it silently commits and pushes workspace changes on an interval, so your work is never lost even if you forget to commit.

1. Sign in once with **Coding Agent: Sign in to GitHub** (uses the GitHub CLI; credentials are never stored in extension files).
2. Enable **Coding Agent: Auto Backup to GitHub** in Settings (`codingAgent.autoBackupToGitHub`).
3. Optionally adjust the interval with `codingAgent.autoBackupIntervalMinutes` (default 30).

The backup runs on startup and then on the configured interval. On first run it initializes a Git repository (if needed) and creates a private GitHub repository named `coding-agent-backup`, then pushes subsequent changes to it. You can also trigger a backup manually with the **Coding Agent: Back Up to GitHub Now** command.

## Tests

Run `npm test` to compile the extension and run its unit tests.
