# Agent Operating Rules — coding-agent-extension

> These are standing instructions for any coding agent working in this
> workspace. Follow them in every session. They are not suggestions.

## 1. Do it — don't delegate.

When a task can be completed with the tools available to you (shell, file
editing, git, package managers, the VS Code CLI, tests), **execute it
directly and report the result**. Do not hand a list of commands back to the
user unless it is physically impossible for you to run them yourself.

Only defer to the user when the step genuinely requires:
- interactive keyboard input *inside* VS Code's UI (e.g. a modal you can't
  reach),
- an Administrator/elevated GUI prompt that cannot be answered non-interactively,
- a click/authorization in a browser (e.g. completing the GitHub device flow),
- secrets or credentials that only the user possesses (never fabricate or
  bypass them).

## 2. Run the full pipeline by default — automatically.

For any change to the extension source (`src/`, `package.json`, `tsconfig.json`,
or any file the extension depends on at runtime), run the complete chain in one
pass **without asking the user**:

```
edit → compile → test → bump version → package (.vsix) → install → commit → push
```

Do not stop at "review this diff" or "here are the commands to run." Do not ask
permission to repackage or reinstall. These are mandatory, automated steps:

- **Compile & test:** `npm test` (compiles via `tsc` then runs the VS Code test runner).
  If tests fail, fix them and rerun.
- **Bump version:** increment the `version` field in `package.json` (patch bump
  unless the user asks for a minor/major bump). Never reuse a version that
  already has a `.vsix` in the workspace.
- **Package:** `npx @vscode/vsce package --allow-missing-repository`.
- **Install locally:** `code --install-extension coding-agent-extension-<version>.vsix --force`.
- **Commit & push:** see the Git section below.

Only skip a step when it is genuinely impossible to run it in this
environment. Leaving the installed extension stale (old `out/`) while the
source is new is a bug — always repackage and reinstall after editing source.

## 3. Verify with facts, not assumptions.

After every action, check the actual output — exit codes, `git status`,
compiler/test output, `gh auth status`, `code --install-extension` result — and
report what happened. If something fails, fix it and retry rather than
stopping and asking.

## 4. When you must hand something back:

- Give a **single**, minimal, copy-paste-ready command or instruction.
- Explain *why* it cannot be automated in this environment.
- Never produce a multi-step list you could have done yourself.

## Project specifics

- **Build:** `npm run compile` (TypeScript → `out/`). The extension runs from
  `out/src/extension.js`.
- **Test:** `npm test` (compiles then runs the VS Code test runner).
- **Package:** `npx @vscode/vsce package --allow-missing-repository`.
- **Install locally:**
  `code --install-extension coding-agent-extension-<version>.vsix --force`.
- **Cleanup after packaging:** delete any one-off temp scripts (e.g.
  `bump-version-*.mjs`, `tmp_*.mjs`, `tmp_*.txt`) you created. Keep the
  `.vscodeignore` and `.vsix` bloat minimal — only `resources/`, `out/src/`,
  `package.json`, `README.md`, `LICENSE.txt`, and `AGENTS.md` need to ship.
- **Sign in to GitHub:** `gh auth login --hostname github.com --git-protocol
  https --web` (opens the browser; the user must approve the device code — this
  specific browser click is non-delegable).
- **Git:** commit and push to `origin` regularly; verify with `git status` that
  the working tree is clean and pushed after each task.

## Editing the large file safely

`src/extension.ts` is ~16 KB with a large inline minified HTML template literal.
Do **not** rewrite it wholesale with the file tool — that has corrupted it
before. Instead use a **patch script** (the `fix-*.mjs` / `patch-*.mjs` /
`wire-*.mjs` pattern already present in the repo) that does exact-string
replacements with safety checks, or make targeted edits.
