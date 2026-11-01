# Coding Agent Extension — Code Review

Review date: automated review. The extension is well-structured overall; no security
issues were found beyond the items below. Findings are ordered by importance.

## How to apply the fixes

Run the scripts **in order** from this directory:

```bash
node apply-agent-fixes.js   # agent.ts: web_search fix + run_command tool + token bump
node apply-fixes.js         # extension.ts unused-import cleanup + delete dead file
node apply-backup.js        # extension.ts automatic GitHub backup wiring
node apply-github-login.js  # extension.ts GitHub status bar + login auto-prompt
```

Then compile, test, and repackage:

```bash
npm run compile
npm test
npx vsce package
```

Each script verifies every replacement atomically — it aborts rather than leave a file
half-edited.

Changes already made directly (committed) rather than via a script:

- Added `.vscodeignore`.
- Added `src/backup.ts` (automatic backup module).
- Added `src/github.ts` (auth detection + status bar controller).
- Added `codingAgent.autoBackupToGitHub` / `codingAgent.autoBackupIntervalMinutes` /
  `codingAgent.promptForGitHubLogin` settings and the `codingAgent.backupNow` command
  wiring (package.json edits in `apply-backup.js` / `apply-github-login.js`).
- Added `test/github.test.ts`.
- Updated `README.md`.

---

## 1. CRITICAL — Built-in DeepSeek `web_search` is broken  ✅ in apply-agent-fixes.js

`src/agent.ts` → `CodingAgent.provideSuggestions`. The DeepSeek Responses API performs the
`web_search` tool **server-side** and returns the result as `web_search_call` items in the
`output` array (NOT `function_call` items). The current code only filters for `function_call`:

```ts
const calls = output.filter((item) => item.type === 'function_call');
if (calls.length === 0) {
    const text = getResponseText(response);
    if (!text) throw new Error('DeepSeek returned an empty response.');
    return text;
}
```

When the model chooses built-in web search, `calls.length === 0` and there is no `message`
item yet, so `getResponseText` returns `''` and the extension throws
`"DeepSeek returned an empty response."` — built-in web search can never complete.

Per the DeepSeek docs, a `web_search_call` item must be **passed back** on the next request
so its results are restored into context, and the loop must continue.

Fix (applied by the script):

1. Capture `web_search_call` items in addition to `function_call`.
2. Only terminate when there are **no** function calls *and* no web-search calls.
3. Feed the **whole** previous `output` back as history (restores `web_search_call`
   and any `reasoning` items into context). Also renamed the shadowed local `history`
   to `prev`.

---

## 2. Shell command execution (new)  ✅ in apply-agent-fixes.js

The agent previously had **no way to build or test the software it wrote** — only file
tools and Git/GitHub tools. Added a `run_command` tool:

- Runs a shell command in the opened workspace via `cmd.exe` (Windows) or `/bin/sh`
  (macOS/Linux), with a configurable `timeoutMs` (default 120000, max 600000) and a
  200 KB output cap.
- Wired into the tool dispatch so the model can `npm install`, run `npm test`, start a
  dev server, run the compiled binary, etc., and verify its own work.

⚠️ **Security note:** this runs with the user's own permissions and can execute arbitrary
commands in the workspace. It is as powerful as the user themselves. No sandboxing is
currently implemented; treat it accordingly (consider a file-system/docker sandbox in a
future iteration if running untrusted model output is a concern).

---

## 3. GitHub login detection + status bar + auto-prompt  ✅ NEW (apply-github-login.js)

The user wanted the extension to (a) show whether it is logged into GitHub at the top of
the app, and (b) prompt to sign in — and store fresh credentials — when credentials are
missing or expired.

Implemented in **`src/github.ts`**:

- `checkGitHubAuth(cwd)` returns a discriminated union:
  - `{ state: 'installed', login }`
  - `{ state: 'not-authenticated', reason: 'missing' | 'expired' }`
  - `{ state: 'not-installed' }`
  - `{ state: 'error', message }`
  - It distinguishes **expired** vs **missing** by running `gh auth token`: if a token is
    still stored but `gh auth status` fails, the credentials are treated as expired/revoked.
- `createGitHubStatusBar()` shows a **status-bar item** (top of the window) with a GitHub
  octicon and text like `GitHub: alice`, `GitHub: Not signed in`, or
  `GitHub: sign-in expired`. Clicking it runs `codingAgent.loginGitHub`.
- When the state is `not-authenticated`, it prompts via `showWarningMessage` with
  **"Sign in to GitHub"** / **"Not now"**. On "Sign in", it runs the existing
  `codingAgent.loginGitHub` command, which calls `gh auth login --web` (these credentials
  are stored by the GitHub CLI in `~/.config/gh/hosts.yml`) and then configures Git identity.

Wiring in `src/extension.ts` (via the script):

- Creates the status bar on activation and refreshes it when `promptForGitHubLogin` is on.
- Refreshes it after a successful login so the indicator updates immediately.
- Refreshes it when workspace folders change (Git identity is per-repo).

New setting `codingAgent.promptForGitHubLogin` (default `true`) lets the user disable the
auto-prompt while keeping the status-bar indicator.

Note: credentials themselves are **never** stored by the extension — they live in the
GitHub CLI's own credential store, which is the correct and secure place for them. The
extension only reads auth state via `gh`.

---

## 4. Automatic GitHub backup (new — previously only a "remember to push" reminder)

The extension exposed Git/GitHub tools to the model and a system prompt telling users to
"back up to GitHub regularly", but there was **no mechanism that actually did the backup
automatically** — everything was model-driven and only on explicit user request.

Added a real auto-backup feature:

- **`src/backup.ts`** — `backupWorkspaceToGitHub()` ensures a Git repo + `origin` remote
  (creating a private `gh` repo named `coding-agent-backup` on first run), ensures Git
  identity, commits all changes, and pushes. `isGitHubCliInstalled`/`isGitHubAuthenticated`
  gate the work and fail silently so the extension never nags unauthenticated users.
- **`src/extension.ts`** (via `apply-backup.js`) — a `startAutoBackup()` interval, triggered
  on startup and on the configured interval, with a config-change listener. Also a manual
  **Coding Agent: Back Up to GitHub Now** command.
- **`package.json`** — new `codingAgent.autoBackupToGitHub` (default `false`, opt-in) and
  `codingAgent.autoBackupIntervalMinutes` (default `30`) settings, plus the `backupNow`
  command.

The backup is opt-in (`autoBackupToGitHub` defaults to `false`) so it never pushes without
the user's explicit consent. It reuses the existing GitHub CLI authentication flow and never
stores credentials.

---

## 5. Dead file  ✅ in apply-fixes.js

`src/agent.ts.tmp` is an abandoned copy of `agent.ts`. The script deletes it.

---

## 6. Unused imports in `src/extension.ts`  ✅ in apply-fixes.js

`formatResponse` and `parsePromptInput` are imported but never used in `extension.ts`.
The script removes them from the import (the test file imports `parsePromptInput`
directly from `../src/tools`, which is unaffected).

---

## 7. `max_output_tokens: 4096`  ✅ in apply-agent-fixes.js

`max_output_tokens` bounds both reasoning and visible output. Bumped the internal loop
request to `8192` to reduce truncation risk on long answers. (Low risk; easy to revert.)

---

## 8. `model-check.ts` version comparison (low priority — not changed)

`compareVersions` uses `dateToken` regex `/(\d{4})(?!\d)/`. DeepSeek version tokens such as
`DeepSeek-V4.1-Flash-1017` / `DeepSeek-V4-Pro-0813` yield 4-digit tokens that happen to match,
so it works for within-family comparison, but it is meaningless across families. Since
`checkLatestModel` only compares same-family versions this is acceptable today; consider
documenting the limitation if `compareVersions` is exported for wider use.

---

## 9. Packaging hygiene  ✅ `.vscodeignore` added

Added `.vscodeignore` to keep the `.vsix` small (excludes `test/`, `node_modules/`,
`.vsix` artifacts, map files, etc.).

⚠️ Verify after `vsce package` that `docker-compose.yml` and `searxng/` are **still
included** — they are referenced at runtime via `context.extensionPath` to auto-start the
bundled SearXNG container. If packaging drops them, move them under `resources/` or relax
the ignore list.

---

## Verified correct (no change)

- `fetch_page` calls the real `POST https://api.deepseek.com/v1/tools/fetch`.
- `buildSearxngSearchUrl` validation (rejects credentials/query/fragment) is correct.
- `resolveWorkspacePath` path-traversal guard is correct.
- Git/GitHub helpers use `spawn` (no shell injection) with `windowsHide`/`env`.
- API keys are stored via VS Code SecretStorage, never written to disk.
