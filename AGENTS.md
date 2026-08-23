# AGENTS.md — dsh-task-runner

## Commands

```bash
pnpm install     # pnpm 11; pnpm-lock.yaml is committed
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest: unit/integration tests
pnpm lint        # biome; must exit 0 before committing (pnpm format auto-fixes)
pnpm build       # tsdown → lib/index.mjs (host) + lib/client.js (browser)
```

Standard verification after any code change: typecheck → test → lint → build → start the test instance → run the relevant `tests/cdp-*.mjs` browser acceptance scripts.

## Structure & responsibilities

- **Host side** (`src/host/`): plugin assembly, task model and persistence, the `/task-runner` RPC channel, the LLM tool, background command execution, plugin settings.
- **Client side** (`src/client/`): the three UI surfaces (session header, run-config dialog, hero page) and shared store/hooks, registered into the official slots: `conversation.session.header.utilities`, `shell.overlay`, `conversation.hero.workspace`.
- **Data & settings**: tasks live in a storage domain named `task_runner` (underscore; the settings namespace keeps the kebab-case `task-runner` and holds the `toolEnabled` switch). Client→host traffic uses the Connection RPC channel (loopback).
- **Model-facing tool**: `task_runner_config` write actions are gated by a `tools/pre-execute` guard — sandbox mode `danger-full-access` allows through, otherwise the standard approval channel decides; the tool body itself never requests approval. Changing a task field requires four synchronized updates: the storage schema, the tool output schema (`additionalProperties: false` — an undeclared field rejects the whole tool result), the client types, and the locale dictionaries.
- **Browser/host state sync**: host-side task mutations have no push channel to the browser; every entry point that opens the picker or dialog triggers a local refresh first.

## Tests

- The test instance uses a dedicated profile and port (currently 3190); never touch the long-running development service (3080).
- Under `tests/`: `*.spec.ts` are vitest unit tests; `cdp-*.mjs` are headless-Chrome acceptance scripts (CDP 9222, fresh user-data-dir each run, scripts clean up leftover tabs on start).
- Acceptance screenshots are not committed (`tests/screenshots/` is ignored).
