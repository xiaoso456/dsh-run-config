# `tests/external/` — the external-dependency acceptance lane

Everything in this folder exists for one reason: **the two acceptance scripts
that need a live agent turn must not depend on the developer's real LLM
account.** They still exercise the real dsh provider adapter, the real streaming
parser, the real tool loop and the real token accounting — only the socket at
the far end belongs to a local mock.

In the 20260927-103210 verification round both agent-driven CDP scripts failed
at the same place with the same UI text, `本轮运行失败当前请求的额度已用尽`:

| script | raw evidence | what actually went wrong |
|---|---|---|
| `tests/cdp-llm-run.mjs` | `{"newSession":true,"taskPicked":true,"runClicked":true,"draft":"","turnStarted":false}` | the prompt was delivered, the agent turn could not run (quota) |
| `tests/cdp-pwsh.mjs` | `run feedback: {"started":true,"failed":true,"snippet":"本轮运行失败当前请求的额度已用尽"}` | the command job failed for its own reason (see below) and the notice turn could not run either |

Both used the live provider route configured in the developer's `~/.dsh`. This
lane replaces that endpoint with `mock-llm/server.mjs`, and both scripts exit 0
with **identical assertions**.

## Layout

| path | what it is |
|---|---|
| `mock-llm/server.mjs` | the mock provider: an OpenAI `node:http` server speaking the Anthropic Messages SSE dialect dsh actually calls, plus an OpenAI-compatible `/v1/chat/completions` subset. No npm dependency. |
| `mock-llm/responses.acceptance.json` | the scripted replies the acceptance lane uses (title request → canned title, everything else → echo the last user text). |
| `mock-llm/responses.tool-call.example.json` | example of a scripted **tool call** round (`task_run_config`). |
| `mock-llm/responses.job-output.example.json` | example of reacting to what the harness sent: captures the job id out of a completion notice and calls the real `job_output` tool with it, so a background job's stdout/stderr becomes readable through the mock's log. |
| `mock-llm/responses.quota-error.json` | fault injection: answers with the live provider's quota envelope, used by control 2 below. |
| `mock-llm/dsh-mock-llm.patch.yml` | the dsh-side wiring: a launcher `--patch` overlay that re-points the `llm-deepseek` entry at the mock. |
| `run-mock-acceptance.mjs` | the orchestrator: private home → mock → dsh instance → headless Chrome → both CDP scripts → mock counters → evidence logs → PID-tree teardown. |

## Quick start

```bash
# green lane: mock provider, both agent-driven CDP scripts
node tests/external/run-mock-acceptance.mjs \
  --dsh-port 3191 --cdp-port 19334 --mock-port 19399

# control lane: the SAME overlay, but the mock process is never started
node tests/external/run-mock-acceptance.mjs --skip-mock --prefix mock-nomock \
  --dsh-port 3191 --cdp-port 19334 --mock-port 19399

# mock only (for manual probing against your own instance)
node tests/external/mock-llm/server.mjs --port 19399 \
  --script tests/external/mock-llm/responses.acceptance.json \
  --log /tmp/mock-llm-requests.jsonl
```

The orchestrator never runs `pnpm`/`powershell`, never touches the long-running
development service (**3080**) or the developer's browser (**9222** — both are
refused by `assertNotReservedPort`), and kills every process it started by PID
tree. Flags: `--wiring patch|env`, `--permission-mode MODE`, `--home DIR`,
`--keep-home` (keep the private home **after** the run for inspection — it is
reset before *every* run, because a reused session is exactly what makes
`cdp-llm-run`'s `1 轮` assertion fail), `--prefix NAME`,
`--only cdp-llm-run|cdp-pwsh`, `--keep-alive`, `--script FILE`, `--log-dir DIR`.

## How dsh is pointed at the mock

Two independent, process-scoped mechanisms — neither writes anything under
`$DSH_HOME`:

1. **`--patch` overlay (default).** `dsh --patch <file>` is the launcher's own
   "extra patch-list overlay applied after the profile layer" (`dsh --help`). The
   overlay targets the entry that registers the provider route the agent uses:

   ```yaml
   - id: llm-deepseek
     name: '@deepseek-ai/dsh-llm-deepseek-api-key'
     config:
       baseURL: http://127.0.0.1:19399
       apiKeyEnv: MOCK_LLM_API_KEY
   ```

   `llm-deepseek` registers route `deepseek-official`, which is also
   `agent-default-model`'s provider, so every agent request follows it.
   `baseURL` replaces the adapter's own fallback chain
   (`config.baseURL ?? $DEEPSEEK_BASE_URL ?? https://api.deepseek.com/anthropic`,
   `dsh-llm-deepseek/lib/types/config.d.ts`), and `apiKeyEnv` names a mock-only
   credential so the real `DEEPSEEK_API_KEY` is never resolved.
   Verify the applied layer without booting anything:
   `node <dsh>/lib/bin.js --profile dsh-task-runner --patch <file> --dump-config`.

2. **Environment variables (`--wiring env`).** `DEEPSEEK_BASE_URL=http://127.0.0.1:<port>`
   plus `DEEPSEEK_API_KEY=<mock key>`: the inherited process environment is the
   most trusted layer of the credentials/launch-environment snapshot, so no
   stored credential is read.

Since dsh 0.1.7 the provider's settings live in the **profile patch**
(`profiles/<name>/cordis.patch.yml`; a legacy `settings.yaml` is imported there
on boot), and the shipped `dsh-base` row for `llm-deepseek` carries **no**
`config` at all — checked with `--dump-config` — so nothing shadows either
mechanism unless the developer's own profile explicitly sets one of these fields.

### Why the payload is Anthropic Messages, not `/v1/chat/completions`

The route the web app uses (`deepseek-official`) is the DeepSeek **Messages**
adapter: it POSTs `${baseURL}/v1/messages` with `accept: text/event-stream` and
`anthropic-version: 2023-06-01`, and parses `message_start` /
`content_block_start` / `content_block_delta` / `content_block_stop` /
`message_delta` / `message_stop` frames. A mock that only served
`/v1/chat/completions` would never be reached, so the mock implements the real
dialect first and keeps an OpenAI-compatible `/v1/chat/completions` subset
(JSON and SSE, content and tool calls) for pi-ai-backed routes and manual probes.

## What the mock can be told to answer

Rules are an ordered, first-match-wins list (`--script FILE`); `{}` matches
everything, so the last rule is the default.

```jsonc
[
  { "when": { "maxTokensAtMost": 64 }, "reply": { "text": "Mock 会话标题" } },
  { "when": { "textIncludes": "User-started job" },
    "capture": { "jobId": "job (task-[0-9]+)" },
    "reply": { "toolCalls": [{ "name": "job_output", "input": { "job_id": "${jobId}" } }] } },
  { "when": {}, "reply": { "echo": true } }
]
```

`when` fields: `model`, `path`, `textIncludes`, `purpose`, `toolName`,
`hasTools`, `stream`, `index`/`indexes` (1-based request ordinal),
`maxTokensAtMost`, `thinkingDisabled`.
`reply` fields: `text` (string or chunk array), `toolCalls`, `stopReason`,
`usage`, `error` (`{status, type, message}` — e.g. `402` reproduces the quota
failure on purpose), `echo`.
`times` bounds how often a rule fires.

Every request is logged as one JSON line (`--log FILE`) and summarised by
`GET /__mock/status`: ordinal, timestamp, path, model, stream flag, message
count, the last user text, tool names, the harness's
`x-deepseek-harness-session-id` / `-user-id` headers, the reply kind, the
captured groups and any `tool_result` text the harness sent back.

## Isolation — what this lane can and cannot touch

| mechanism | effect |
|---|---|
| `--patch` overlay / `DEEPSEEK_BASE_URL` | process-scoped provider override; **no** `~/.dsh` file is written, backed up or renamed |
| `apiKeyEnv: MOCK_LLM_API_KEY` (+ env var) or `DEEPSEEK_API_KEY` env override | the stored real credentials are never resolved |
| private `DSH_HOME` (default `<os.tmpdir()>/dsh-mock-acceptance-home`, recreated per run) | `sessions/`, `storages/`, `cache/` are this lane's own: no previous session is resumed, so run #1 and run #10 are the same scenario; nothing is added to the developer's session list |
| `profiles/dsh-task-runner` **junction** onto the real profile dir | the plugin under test is the developer's build, loaded read-only; the orchestrator hashes `cordis.patch.yml` before/after and reports `sharedProfileUnchanged` |
| `documents/deepseek-harness/default-workspace` **junction** onto this repository | the lane's first-use workspace *is* the checkout, so the session cwd — and therefore the pwsh probe file `tests/cdp-pwsh.mjs` looks for at the repository root — is where the script expects it (see below) |
| reserved-port refusal + PID-tree `taskkill /T /F` | 3080 and 9222 are never touched, and the lane leaves no orphan Chrome, instance or mock behind |

`fs.rmSync(..., {recursive: true})` removes a junction without descending into
its target (verified: a file inside the target survives), so recreating the
private home per run cannot reach the profile or the checkout.

### Lane conditions (host facts, not plugin behaviour)

* **`DSH_PERMISSION_MODE=danger-full-access`** (the orchestrator default).
  Measured on this host: with `workspace-write`, `ctx.shell` is
  `SandboxPwshExecutor` and the Windows ACL restricted-token runner refuses to
  grant write inside this checkout —
  `SandboxUnavailableError … Runner failure: windows-acl-run: SetNamedSecurityInfoW failed (Win32 5): grantWrite(D:\code\pi-gateway-project\dsh-plugin\dsh-task-runner)`.
  No command can run at all, so the pwsh probe can never be written. The
  provider's own message names the escape ("otherwise switch the consumer to
  danger-full-access"); it is set on this lane's instance process only. Evidence:
  `tests/runs/20260927-103210/logs/mock-shell-sandbox-*.log`.
* **Pinned first-use workspace.** Measured through a real job (its own output,
  pulled back with `job_output`): the command's cwd was
  `C:\Users\<user>\Documents\deepseek-harness\default-workspace`, i.e. the
  harness's first-use workspace under the real `Documents` directory — not the
  checkout that `tests/cdp-pwsh.mjs` hard-codes its probe path against. The lane
  pins that workspace (`workspace-controller` → `documentsDirectory`) into its
  private home as a junction onto the repository, which makes the script's own
  premise true again. **The script's assertions are not touched.**

## How to prove the run had zero external dependency

Measured in the 20260927-103210 round (raw files under
`tests/runs/20260927-103210/logs/mock-*`):

| evidence | what it shows |
|---|---|
| `mock-llm-requests-green.jsonl` + `mock-llm-status.json` | the mock's own request counter and request bodies: 3 × `POST /v1/messages`, `model=deepseek-flash`, `anthropic-version: 2023-06-01`, and the harness's own `x-deepseek-harness-session-id` / `-user-id` headers. Request #3 is the pwsh completion notice (`status: completed, exit code: 0`), i.e. the follow-up turn `cdp-pwsh` triggers really was served here. |
| `mock-session-log-extract.log` | the harness's **own durable session log** (inside the lane's private home) for the same session: `cwd` is the repository, `request/header` names `provider: deepseek-official, model: deepseek-flash`, and the recorded `assistant/message` text is byte-for-byte the mock's reply for that request — the loop request → mock → transcript closes inside dsh's own record. It also contains **no** error/quota/transport event. |
| `mock-nomock-*.log` (control 1) | the same overlay, the mock process never started: the provider is unreachable (`DeepSeek Messages transport failed` in the run feedback) — yet both scripts still exit 0. That is honest evidence about what the assertions measure: `cdp-pwsh` only asserts the probe file (which does not need the LLM at all), and `cdp-llm-run`'s `turnStarted` counts a *failed* turn too. |
| `mock-quota-*.log` (control 2) | fault injection: the mock is up but answers every request with the live provider's own envelope (HTTP 402, `当前请求的额度已用尽`). The UI reproduces the original text verbatim (`run feedback: {"started":true,"failed":true,"snippet":"本轮运行失败当前请求的额度已用尽"}`) while `cdp-llm-run` still exits 0 — so the exhausted balance was **not** sufficient by itself to explain the original red. |
| `mock-sandboxed-*.log` (control 3) | the mock is up, the lane's shell condition is removed (`--permission-mode workspace-write`): `cdp-pwsh` fails with `fileFound: false` exactly as in the 10:32 round. So the pwsh green comes from the lane conditions (unconfined shell + pinned workspace), not from a weakened assertion. |
| `git diff tests/cdp-llm-run.mjs tests/cdp-pwsh.mjs` | the only change on these two files is the documented `DSH_BASE` endpoint injection; every assertion-bearing line is byte-identical to `HEAD` (checked line by line). |
| `mock-run-summary.json` | exit codes per script, the private-home junction map, mock counters and `sharedProfileUnchanged`. |

### A note on the original red (both halves matter)

The 10:32 round failed for **two** stacked reasons, and only one of them was the
quota:

1. the real provider had no balance (the UI text in both scripts), and
2. the instance shared `~/.dsh` with the long-running service, so `cdp-llm-run`
   sent its prompt into an already-used session — its transcript counter was no
   longer `1 轮`, which is literally what the assertion looks for. The lane's
   private home fixes that half (measured: with the shared store the same mock
   run sent `msgs=5` and `turnStarted` was `false`; with the private home it sends
   `msgs=1` and passes).
   For `cdp-pwsh` the load-bearing failure was neither: the default
   `workspace-write` instance could not run the command at all, and the probe file
   was being written to the harness's first-use workspace outside the checkout
   (both measured; see the lane conditions above).

## Can cover / cannot cover

| can cover | cannot cover |
|---|---|
| the whole client → host → provider → stream → transcript path with a **real** dsh adapter and a deterministic reply | real-model reasoning quality, prompt following, or any judgment about what a model would have answered |
| the run control's LLM flow end to end (`cdp-llm-run`: delivery, composer clearing, the turn reaching the transcript) | real provider quota, rate limiting, retry-after/back-off behaviour, provider outages |
| the pwsh -> command job -> completion notice -> agent follow-up turn path (`cdp-pwsh`) with an unconfined shell | command execution **under `workspace-write`** on this host (the ACL runner is unusable here — see above); and the sandbox's own denial rendering |
| streaming (chunked text deltas), tool-call round trips, token/usage accounting, error envelopes (any HTTP status/type you script) | real token counts and real billing; the mock's usage numbers are plausible, not authoritative |
| the session-title request, the compaction request shape, and anything else you can describe as a `when` rule | provider-side features the mock does not implement (Files API uploads, images by file id, thinking signatures) |

Optional extras the mock does **not** need for this lane: real embeddings, real
web search, or any network egress at all — the server binds `127.0.0.1` and makes
no outbound request.
