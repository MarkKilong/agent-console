# agent-console

A chat-plus-IDE web UI for driving agent harnesses (Claude Code first, Codex later) that run
inside an _environment_ — your local machine today, a remote sandbox or VPS later.

Phase 1 is the backend under `packages/`; phase 2 is the Next.js control plane and UI under
`apps/web`.

## Prerequisites

- Node 22+, pnpm, git.
- Claude Code, installed:

  ```sh
  irm https://claude.ai/install.ps1 | iex        # Windows
  curl -fsSL https://claude.ai/install.sh | bash  # macOS / Linux
  ```

  Log in either in a terminal (`claude`, then complete the login) or in the app: add a project
  and use **Connect Claude** in the **Add project** dialog — the sidebar's gear reopens it — which
  drives `claude auth login` inside the environment; you approve in the browser and paste the code
  back. It also accepts a Console API key instead.

  Without Claude Code, set `RUNNER_AGENT=fake` to drive the scripted adapter; the UI works, the
  agent is canned.

### Codex

Codex is the second harness. Install and log in:

```sh
npm install -g @openai/codex
codex login
```

Set `RUNNER_AGENT=codex` and every environment the app opens runs the Codex adapter. The UI
does not offer the choice; it always speaks to whichever agent the runner was configured with.

The adapter drives `codex app-server` over newline-delimited JSON-RPC. Threads run with the
app-server's `on-request` approval policy inside its `workspace-write` sandbox, so Codex asks
before it runs a command or writes a file and each request becomes a `permission_requested`
event like Claude's. Set `CODEX_BINARY` when the executable is not on `PATH` (the Windows
`codex.cmd` shim from npm is fine — the adapter runs it through a shell), and `CODEX_MODEL` to
pin the model.

## Architecture

Ports and adapters, with three moving parts:

```
          ┌─────────────────────┐        EnvironmentProvider (port)
          │  control plane      │  ────►  create / start / stop / destroy
          │  (phase 2 web app)  │         endpoint / status
          └─────────┬───────────┘             │
                    │ WebSocket                │  local adapter spawns a child process
                    │ (commands / events)      ▼  (daytona, e2b, vps come later)
          ┌─────────▼───────────────────────────────────┐
          │  environment                                │
          │   ┌──────────────────────────────────────┐  │
          │   │  runner  (Node service)              │  │
          │   │   ws + /healthz                      │  │
          │   │   AgentAdapter → Claude Agent SDK    │  │
          │   │   thread event log, files, git diff  │  │
          │   └──────────────────────────────────────┘  │
          └─────────────────────────────────────────────┘
```

- **Runner** is invariant: wherever the environment lives, the runner is the same service. It
  wraps the agent harness, exposes a WebSocket, accepts commands, emits a typed ordered event
  stream, reads files, and produces git diffs.
- **EnvironmentProvider** is the port the control plane talks to when it needs an environment.
  Only the `local` adapter exists today.
- **Contracts** are the zod schemas both sides import, so the wire format has exactly one
  definition.

## Packages

| Package              | What it is                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts` | zod schemas and inferred types for commands, events, responses and the environment spec. Exports `PROTOCOL_VERSION`.                                        |
| `packages/runner`    | The Node service that runs inside an environment: WebSocket + `/healthz`, agent adapters, thread event log, file access, git diff.                          |
| `packages/providers` | The `EnvironmentProvider` interface and the `local` adapter that spawns the runner as a child process.                                                      |
| `apps/web`           | Next.js control plane and UI: route handlers that create environments, plus a three-column projects / chat / diff shell driven over the runner's WebSocket. |

## Protocol

Three top-level message kinds travel over the socket:

- `{ kind: 'command', command }` — client to runner.
- `{ kind: 'event', event }` — runner to client. Every event carries `seq` (monotonic per thread,
  starting at 1), `threadId` and `ts`.
- `{ kind: 'response', response }` — runner to client, answering `list_files`, `read_file` and
  `get_diff` by `requestId`.

The runner sends `{ kind: 'hello', protocolVersion, runnerVersion }` immediately on connect.

A turn looks like this:

```
subscribe          →
send_prompt        →
                   ← turn_started
                   ← assistant_delta …
                   ← tool_call_started
                   ← permission_requested
answer_permission  →
                   ← permission_resolved
                   ← tool_call_finished
                   ← assistant_message
                   ← turn_finished
                   ← diff_ready
```

`subscribe` takes an optional `afterSeq`: the runner replays everything newer than that cursor
from its in-memory log, then live-tails. One turn runs per thread at a time; a `send_prompt`
during an active turn produces an `error` event with code `turn_active`.

### Repositories are discovered, not declared

The workspace is whatever folder was opened; the runner works out the git situation itself.
It looks for the repository enclosing the workspace, if any, and for repositories nested up to
three levels below it (skipping `node_modules`). A folder holding several projects diffs each
one under its own prefix (`project_a/src/index.ts`); a project sitting inside a larger checkout
is scoped to itself with a pathspec, so the rest of the checkout is never staged; a nested
repository is excluded from the enclosing one's diff; a plain folder gets no diff and no error.
The `turn_started` branch is the enclosing repository's, or the only nested one's.

### Diffs are per turn

Before a turn starts the runner hashes each repository's share of the working tree — untracked
files included, `.gitignore` respected — into a git tree object, using a throwaway
`GIT_INDEX_FILE` so the repository's own index and HEAD are never touched. It hashes again when
the turn ends and diffs the two trees, so `diff_ready` carries only what _that_ turn changed:
uncommitted work from before the environment was opened, or from an earlier turn, never leaks
into it. A repository the agent created during the turn shows up from the next turn on. Renames
are detected (`status: 'renamed'` plus `oldPath`), binary files get a status with an empty
`patch`, and tree-to-tree diffs read blobs that git already normalized, so `core.autocrlf`
cannot make every line look changed.

`get_diff` with a `threadId` answers with everything since that thread's latest turn started —
including edits made after it finished. Without one, or before the thread has run a turn, it
falls back to the whole workspace against HEAD.

## Runner configuration

| Variable                 | Default              | Meaning                                                                                                                                                        |
| ------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUNNER_TOKEN`           | _(required)_         | Shared secret. The runner refuses to start without it.                                                                                                         |
| `RUNNER_PORT`            | `4310`               | HTTP/WebSocket port.                                                                                                                                           |
| `RUNNER_CWD`             | `process.cwd()`      | Repository root. File reads and diffs are confined to it.                                                                                                      |
| `RUNNER_AGENT`           | `claude`             | `claude` for the real SDK, `codex` for `codex app-server`, `fake` for the scripted test adapter.                                                               |
| `RUNNER_PERMISSION_MODE` | `default`            | Passed through to the SDK's `permissionMode`.                                                                                                                  |
| `CLAUDE_BINARY`          | resolved from `PATH` | Path to the Claude Code executable. On Windows the runner looks for `claude.exe` only: the SDK spawns the binary without a shell, so a `.cmd` shim would fail. |
| `CODEX_BINARY`           | resolved from `PATH` | Path to the Codex executable. `codex.cmd`, `codex.exe` or `codex` on Windows; the adapter runs a shim through a shell.                                         |
| `CODEX_MODEL`            | _(CLI default)_      | Model passed to `thread/start`.                                                                                                                                |
| `CLAUDE_CONFIG_DIR`      | _(machine default)_  | Where the Claude CLI keeps `.credentials.json`. Set it to give an environment its own login; the runner passes it to every `claude auth` it runs.              |
| `ANTHROPIC_API_KEY`      | _(stored key)_       | Not read from the environment: the **API key** tab writes it to `<data dir>/credentials.json` (0600) and the runner injects it into the SDK for each turn.     |
| `AGENT_CONSOLE_DATA_DIR` | `~/.agent-console`   | Root of the per-workspace data dir holding thread logs and the stored API key.                                                                                 |

Clients authenticate with `?token=…` on the WebSocket URL or an `Authorization: Bearer …`
header. A bad token closes the socket with code `4401`. `GET /healthz` is unauthenticated and
returns `{ ok: true, protocolVersion }`.

## Working in this repo

```sh
pnpm install
pnpm typecheck         # every package, plus tests/
pnpm test              # one vitest run over tests/
pnpm build             # emits dist/ per package; needed for `node dist/main.js`
```

Tests live in one root `tests/` folder that mirrors the packages (`tests/contracts`,
`tests/runner`, `tests/providers`, `tests/web`) and are driven by the single root
`vitest.config.ts`. Run one file with `pnpm vitest run tests/runner/diff.test.ts`.

### Lint & format

```sh
pnpm lint              # eslint over the workspace
pnpm lint:fix          # …and apply what it can fix
pnpm format            # prettier --write .
pnpm format:check      # prettier --check .
```

One root `eslint.config.js` and one root `.prettierrc` cover every package; ESLint owns
correctness and naming, Prettier owns formatting (single quotes, semicolons, 100 columns).

File names are kebab-case everywhere except the file names Next.js reserves (`page.tsx`,
`layout.tsx`, `route.ts`); identifiers are PascalCase for types and components, camelCase
otherwise, with snake_case and PascalCase allowed on properties that mirror wire fields.

Run the runner in watch mode:

```sh
RUNNER_TOKEN=dev RUNNER_AGENT=fake pnpm --filter @agent-console/runner dev
curl http://127.0.0.1:4310/healthz
```

## Run the web app

`apps/web` is the control plane: it owns the `LocalProvider`, so it spawns a runner per
environment rather than talking to one you started yourself.

With Claude Code installed and logged in (`claude /login`), no configuration is needed:

```sh
pnpm dev:web   # http://localhost:3000
```

To run the UI on a machine without Claude, copy `apps/web/.env.example` to
`apps/web/.env.local`; it selects the scripted `fake` agent.

The dev and build scripts compile `packages/*` first: the app imports the workspace packages
from their `dist/`, and the provider prefers the runner's compiled `dist/main.js` when spawning.

**Add project** offers two sources: a **Local folder** on this machine, or a **Git URL** that is
cloned first. A local folder can be browsed for anywhere on the machine instead of typed. Clones
always land under `~/agent-console`, which is created on demand; "Clone into" browses only that
folder, where subfolders can be made from the dialog to file clones under — the last choice is
remembered. A private GitHub clone uses the sign-in from **Settings → Configuration** when there is one.

Projects live in `localStorage`, so the list — plus the composer's model/effort/access pickers and
which side panels are open — survives a reload. Selecting a project posts to
`POST /api/environments`, which returns `{id, url, token}`;
the browser then opens a WebSocket to the runner and drives it directly — the Next.js server is
not in the message path. Switching projects destroys the previous environment first.

| Route                                   | Does                                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/environments`                | `{repoPath, agent?}` → creates an environment and returns `{id, url, token}`. `agent` is `claude` or `codex` and overrides `RUNNER_AGENT` for that environment.     |
| `GET /api/environments/:id`             | Environment status.                                                                                                                                                 |
| `DELETE /api/environments/:id`          | Destroys the environment and kills its runner.                                                                                                                      |
| `GET /api/folders?path=`                | One level of the folder browser: `{path, parent, entries, roots}`. No `path` means the home folder.                                                                 |
| `POST /api/projects/inspect`            | `{path}` → `{path, name, isGitRepo}` for a folder that exists.                                                                                                      |
| `POST /api/projects/clone`              | `{url, parent?, name?}` → clones into `<parent>/<name>` under the clone root and returns `{path, name}`. `GET` answers `{parent}` with the clone root, creating it. |
| `GET /api/projects/clone-folders?path=` | The same browser fenced to the clone root; `POST {parent, name}` makes one subfolder of it and returns `{name, path}`.                                              |

`RUNNER_AGENT`, `CLAUDE_BINARY`, `CODEX_BINARY`, `CODEX_MODEL` and `CLAUDE_CONFIG_DIR` are
optional overrides read from the Next.js process and forwarded into every runner it spawns. The defaults are the real
agent and the `claude` executable found on `PATH`; set `CLAUDE_BINARY` only when it lives
somewhere else:

```sh
CLAUDE_BINARY=/opt/claude/bin/claude pnpm dev:web
```

The API is local-only and unauthenticated: it hands out runner tokens, so do not expose it.

Smoke-test the control API without the browser:

```sh
curl -s -X POST http://127.0.0.1:3000/api/environments \
  -H 'content-type: application/json' \
  -d '{"repoPath": "C:/path/to/repo"}'
# {"id":"…","url":"ws://127.0.0.1:54688","token":"…"}
curl -s http://127.0.0.1:54688/healthz
curl -s -X DELETE http://127.0.0.1:3000/api/environments/<id>
```

Typechecking and tests resolve `@agent-console/contracts` to its TypeScript source, so no build
step is required for either. Compiled output (`dist/`) is what `pnpm start` and the Dockerfile
use.

That is also why each package keeps two tsconfigs: `tsconfig.json` maps the workspace packages
to their sources with `paths`, which `tsconfig.build.json` cannot do because emitting a file
from outside `rootDir` is an error. TypeScript project references would fold them into one file
each, but they forbid `tsc --build --noEmit`, so typechecking would have to emit `dist/` and the
editor would type every cross-package import against the last build instead of the source.

## Manual smoke test with the real Claude binary

This exercises the real SDK end to end. Nothing in the automated test suite does.

1. Pick a scratch git repository to work in — the agent can edit files there.

   ```sh
   mkdir -p /tmp/smoke && cd /tmp/smoke && git init && echo hello > README.md && git add -A && git commit -m init
   ```

2. Start the runner against it, pointing at the real binary (on Windows,
   `C:\Users\<you>\.local\bin\claude.exe`):

   ```sh
   RUNNER_TOKEN=dev \
   RUNNER_CWD=/tmp/smoke \
   CLAUDE_BINARY="$(command -v claude)" \
   pnpm --filter @agent-console/runner dev
   ```

3. Confirm it is up:

   ```sh
   curl http://127.0.0.1:4310/healthz
   # {"ok":true,"protocolVersion":1}
   ```

4. Connect a WebSocket client to `ws://127.0.0.1:4310/?token=dev` and send, as JSON text frames:

   ```json
   {"kind":"command","command":{"type":"subscribe","threadId":"t1"}}
   {"kind":"command","command":{"type":"send_prompt","threadId":"t1","text":"Add a LICENSE file with the MIT licence."}}
   ```

5. Watch the event stream. When a `permission_requested` event arrives, answer it with its
   `requestId`:

   ```json
   {
     "kind": "command",
     "command": {
       "type": "answer_permission",
       "threadId": "t1",
       "requestId": "<from the event>",
       "decision": "allow"
     }
   }
   ```

6. The turn ends with `turn_finished` followed by `diff_ready`, whose `files` should contain the
   LICENSE file with status `added`. `git status` in `/tmp/smoke` should agree.

7. Send a second `send_prompt` on the same `threadId`. The runner passes the captured
   `session_id` back to the SDK as `resume`, so the agent should remember the first exchange.

A quick client, if you would rather not write one:

```sh
npx wscat -c "ws://127.0.0.1:4310/?token=dev"
```

## Docker

`packages/runner/Dockerfile` builds a `node:24-slim` image with git and Claude Code installed
via the native installer. Build it from the repository root:

```sh
docker build -f packages/runner/Dockerfile -t agent-console-runner .
docker run --rm -e RUNNER_TOKEN=dev -p 4310:4310 -v "$PWD:/workspace" agent-console-runner
```
