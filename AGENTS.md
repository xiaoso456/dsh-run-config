# AGENTS.md — dsh-run-config

## Commands

```bash
pnpm install     # pnpm 11; pnpm-lock.yaml is committed
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest: unit/integration tests
pnpm lint        # biome; must exit 0 before committing (pnpm format auto-fixes)
pnpm build       # tsdown → lib/index.mjs (host) + lib/client.js (browser)
pnpm build:types # clears lib/types, then tsc -p tsconfig.build.json → lib/types/**.d.ts
```

`pnpm build:types` is part of the published artifact, not an optional extra: `package.json` `types` / `exports["."].types` / `exports["./client"].types` all point into `lib/types/**`, and `files` ships it. It clears `lib/types` before compiling on purpose (a stale declaration from an older layout would otherwise be packed); `pnpm prepare` runs `build:types` + `build`. Run both before anything that publishes or packs.

On Windows `pnpm` is a `pnpm.cmd` shim, so every `pnpm <script>` spawns a visible `cmd.exe` window. When a flashing console is unacceptable, run the tools' JS entry points directly (no shim, same result): `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vitest/vitest.mjs run`, `node node_modules/@biomejs/biome/bin/biome check .`, `node node_modules/tsdown/dist/run.mjs`. The same rule applies to `powershell` — never drive anything through it.

Standard verification after any code change: typecheck → test → lint → build → build:types → start the test instance → run the relevant `tests/cdp-*.mjs` browser acceptance scripts.

## Structure & responsibilities

- **Host side** (`src/host/`): plugin assembly, task model and persistence, the browser RPC routes, the LLM tool, background command execution, plugin settings.
- **Client side** (`src/client/`): the three UI surfaces (session header, run-config dialog, hero page) and shared store/hooks, registered into the official slots: `conversation.session.header.utilities`, `shell.overlay`, `conversation.hero.workspace`. UI behaviour that can be stated without a DOM belongs in `core/` as a pure module (no React, no browser API) — `core/createInput.ts` derives the dialog's "New" scope, `core/pendingRun.ts` the hero → session handoff — so it is unit-tested in `tests/create-scope.spec.ts` / `tests/pending-run.spec.ts` while the component keeps only the wiring and the effects.
- **Data & settings**: tasks live in a storage domain named `task_runner` (underscore). The plugin's own Cordis `Config` — entry id `task-runner` — declares the `toolEnabled` switch as a `.volatile()` field, which is the only kind of field the dsh 0.1.7 settings form edits; the host body reads it off the stable reference and re-syncs on `settings/document-updated`. Client→host traffic uses the Connection **shared `/api` channel**: one exact Fetch route per endpoint (`POST /api/task-runner/<endpoint>`, registered with `connection.fetch.register`) whose carrier applies the browser-session fence. Private channels via `connection.rpc.handle` are gone: dsh 0.1.5 resolves the registering context's `webServer` against the Connection plugin's own fiber, which no longer injects it, so every `rpc.handle` call fails at plugin load. `src/shared/wire.ts` is the single source for the channel, namespace, and endpoint list used by both halves.
- **Model-facing tool**: `task_run_config` write actions are gated by a `tools/pre-execute` guard — sandbox mode `danger-full-access` allows through, otherwise the standard approval channel decides; the tool body itself never requests approval. Changing a task field requires four synchronized updates: the storage schema, the tool output schema (`additionalProperties: false` — an undeclared field rejects the whole tool result), the client types, and the locale dictionaries.
- **Browser/host state sync**: host-side task mutations have no push channel to the browser; every entry point that opens the picker or dialog triggers a local refresh first.

## Tests

- The test instance uses a dedicated profile and port (currently 3190); never touch the long-running development service (3080).
- Under `tests/`: `*.spec.ts` are vitest unit tests; `cdp-*.mjs` are headless-Chrome acceptance scripts (fresh user-data-dir each run; scripts clean up leftover tabs on start); `verify-*.mjs` are manual real-service checks outside `pnpm test`.
- CDP endpoint: the scripts default to `http://127.0.0.1:9222` but are **not** tied to it — `DSH_CDP_PORT=19333 node tests/cdp-refresh.mjs` (or `DSH_CDP_HTTP=http://127.0.0.1:19333`, which wins when both are set) points them at your own headless Chrome. Resolution lives in `tests/lib/cdp-endpoint.mjs`. Never reuse a port that an unrelated browser already holds, and never end someone else's browser process.
- `tests/lib/` is **tracked** test infrastructure (the CDP/RPC helpers: `cdp-endpoint.mjs`, `cdp-chrome-launch.mjs`, `web-session.mjs`), imported by every `cdp-*.mjs`; keep it in version control so a clean clone can re-run the acceptance scripts.
- CDP scripts need a browser session: export `DSH_WEB_TOKEN` with the `?token=` value from the URL `dsh web` prints (`tests/lib/web-session.mjs` exchanges it for the auth cookie and serves `authenticatedUrl()` / `rpc()`).
- Acceptance screenshots are not committed (`tests/screenshots/` is ignored).
- `tests/external/` is the external-dependency lane: a local mock LLM provider plus an orchestrator that serves the two agent-driven CDP scripts from it instead of the developer's real provider account — start there (`tests/external/README.md`) before re-running `cdp-llm-run.mjs` / `cdp-pwsh.mjs` on a machine whose model quota is exhausted.

## e2e lane (`e2e/`)

A second, higher-level acceptance lane on [tester-army/e2e](https://github.com/tester-army/e2e) (`e2e` + `@e2e-dev/web`, in root `devDependencies`). Where the `cdp-*.mjs` scripts assert by hand and report only an exit code, this lane lets an **agent** find and operate the controls and checks the result with ordinary locators — so a renamed button does not break a test, and a passing run is backed by a video.

```bash
pnpm test:e2e                              # build, then run the whole suite
npx e2e run --config e2e/e2e.config.ts tests/03-agent-runs-command.e2e.ts   # one file
npx e2e list --config e2e/e2e.config.ts    # collect without running
```

Everything lives under `e2e/` — the config's directory is the e2e project root, so `e2e.config.ts`, `tests/`, and `.e2e/` are all relative to it. Do not move the config to the repository root: the lane is deliberately outside the plugin's own `tsconfig`/`biome`/`vitest` scope, and `e2e/tsconfig.json` typechecks it separately.

**Setup.** `cp e2e/.env.example e2e/.env` and fill in the model. `.env` and `.env.local` are both gitignored. Any OpenAI-compatible endpoint works; the values are written for Ollama Cloud. A local Ollama needs `http://localhost:11434/v1`, **not** `.../api/chat` (that is Ollama's native protocol). The lane also needs the global dsh CLI and the `dsh-task-runner` profile at `$DSH_HOME/profiles/dsh-task-runner` — `e2e/launch-dsh.mjs` fails with a clear message when either is missing.

**How a run is isolated.** `launch-dsh.mjs` starts a private instance on the free port e2e picked (`app.url` port 0 → `{port}` in `command.args`), with:

- a scratch `DSH_HOME` under `e2e/.e2e/`, recreated every start, so no session, storage, or credential of the developer's is read or written;
- a junction `profiles/dsh-task-runner` → the real profile (this is what loads the plugin under test, via that profile's `link:` to this checkout);
- a junction `<home>/documents/deepseek-harness/default-workspace` → this repository, so a session's working directory is the checkout;
- `--patch e2e/dsh.patch.yml`, a process-scoped overlay (nothing under `$DSH_HOME` is edited). It pins `workspace-controller`'s `documentsDirectory` into the private home, turns off `ui-settings-models`' `credentialOnboarding` (the first-run "Add an API key" modal sets `#root.inert` and blocks every interaction), and points `llm-deepseek` + `agent-default-model` at the configured endpoint;
- `DSH_PERMISSION_MODE=danger-full-access`. The win32 ACL sandbox cannot grant write inside this checkout, so a command task fails silently — as exit code 127 — without it.

**Two things about the model endpoint.** e2e's client appends `/chat/completions` and wants `.../v1`; the instance's `llm-deepseek` provider speaks Anthropic, appends `/v1/messages` itself, and needs the `/v1` stripped. `launch-dsh.mjs` does that conversion. e2e also spawns `app.command` with an **allowlisted** environment (PATH, HOME, TMPDIR, TMP, TEMP, SystemRoot, COMSPEC), so the `.env` values are passed explicitly through `command.env` in `e2e.config.ts` — adding a variable to `.env` alone will not reach the launcher.

**Sign-in.** `tests/auth.setup.e2e.ts` exchanges the launch token for the session cookie and saves it as the `dsh` session. It must not fill a credential form: once a secret is filled, e2e withholds model pixels and assertion screenshots for the rest of that session and `app.screenshot()` becomes `POLICY_DENIED`, which would defeat the point of the lane.

**Entering a session.** A fresh private home has no session with content, so the app sits on the hero page — and the session-header run control only exists inside a session. `helpers.ts`'s `enterSession` sends one message to create one (clicking a sidebar row does not navigate on this build). This is plumbing, not the thing under test.

**Writes.** Tests seed state over the plugin's real RPC (`helpers.ts`'s `rpc`/`createTask`) rather than through the dialog, and `afterEach` deletes what they made. The one file effect, in `03-agent-runs-command.e2e.ts`, writes a marker under `e2e/.e2e/`.

**The replay cache is the point.** Each verified `agent.act` is recorded, so the next run replays it with no model call; when a control or the end state no longer matches, the agent takes over, re-does the step, and re-records it. A test therefore survives the UI changing. The cache lives in `e2e/.e2e/cache/` and is **not committed**, so a fresh clone pays for the model once while it records. `workers`, `retries`, and `cache` are pinned in the config rather than left to e2e's CI detection: this shell carries `CI=true`, which would otherwise demote the cache to read-only and stop it recording at all.

**Output.** `e2e/.e2e/` (gitignored): `results/<test>/attempt-1/video/video.webm` for every attempt (`video: 'on'`), `screenshots/*.png` only where a test calls `app.screenshot()` (failures always get one), `results/<test>/trace.md` for the step-by-step record, and `report.json` for everything. `results/` is **wiped at the start of every run**, so an earlier run's videos are gone unless copied out first.

**Reading a run.** `trace.md` lists what happened — each action and each assertion, in order, with the model's taps and the screen changes. It carries no "expected result" column: the expectation lives in the test's own `expect(...)` call, next to the `agent.act` it follows. On a failure the report's error carries `details.expected` / `details.actual`.

## Icon & wordmark

`assets/` holds the README header art and the plugin icon; `package.json` `icon` points at `assets/icon.webp`. That path must stay relative and inside the package directory, be a regular file, and stay under 256 KiB — otherwise the host **throws** and the plugin shows a metadata error instead of falling back to a default icon. The generator is a one-off script and is not committed.
