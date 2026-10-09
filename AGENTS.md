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

## Icon & wordmark

`assets/` holds the README header art and the plugin icon; `package.json` `icon` points at `assets/icon.webp`. That path must stay relative and inside the package directory, be a regular file, and stay under 256 KiB — otherwise the host **throws** and the plugin shows a metadata error instead of falling back to a default icon. The generator is a one-off script and is not committed.
