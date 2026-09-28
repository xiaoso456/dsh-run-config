/**
 * The `run-configuration` skill: the detailed usage guide for the
 * `task_run_config` tool. The tool's own description stays lean (concept,
 * trigger, defaults); the full parameter reference, decision rules, and
 * examples live here and are loaded on demand through the official skill
 * mechanism (catalog summary injected, content fetched when the model asks).
 * @module @xiaoso/dsh-run-config/skill
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: the `ctx.skills` Context merge (official skill registry).
import type {} from '@deepseek-ai/dsh-skill'

/** Skill name (official `isSkillName`: lowercase letters/digits + hyphens). */
export const RUN_CONFIGURATION_SKILL = 'run-configuration'

/** Catalog summary injected into the model context (keep it short). */
const DESCRIPTION =
  'How to use dsh-run-config run configurations: when to create vs reuse, ' +
  'scope/type defaults, and the full parameter reference with examples.'

/** When the model should load this skill. */
const WHEN_TO_USE =
  'When the user asks to save, remember, or reuse an operation as a run ' +
  'configuration, or when task_run_config usage details are needed.'

/** The full usage guide, loaded on demand. */
const CONTENT = `# Run configurations (dsh-run-config)

A run configuration is a reusable launch preset for the web run-control:
either an LLM prompt sent into the current session, or a shell command run in
the background. The user launches a configuration from the web UI (session
header or new-session page); the task_run_config tool only manages the
stored configurations.

## When to create vs reuse
- CREATE when the user asks to save/remember an operation for one-click
  reuse, or mentions a recurring action.
- LIST first and REUSE an existing configuration when the user asks to run
  something — do NOT create a new one unless asked.
- Do NOT create a configuration for one-off operations.

## Defaults
- scope: "workspace" by default, with the current session's workspace path
  (infer it from the session context, e.g. the session's cwd). Use "global"
  only when the user explicitly wants the configuration available in every
  workspace.
- type: "command" for shell commands, "llm" for prompts sent to the session.

## Parameters
- action: "list" | "create" | "update" | "delete" | "duplicate"
- query: with list, filter configurations by name substring (case-insensitive)
- id: required for update / delete / duplicate
- name: configuration name (create; optional in update)
- description: optional note about what the configuration does
- type: "llm" | "command"
- scope: "workspace" (default) | "global"
- workspacePath: canonical workspace directory path; with scope=workspace it
  defaults to the current session's workspace path (pass it explicitly when the
  call has no session workspace)
- llmPrompt: the prompt sent to the session; required for type=llm
- autoSend: with type=llm, send the prompt immediately (default true); false
  only fills the composer so the user can edit before sending
- command: the bash command to run in the background; required for type=command
- notifyLlm: whether the session LLM is notified when the background command
  finishes (default true)

## Examples
1. Create a command configuration in the current workspace:
   action=create, type=command, scope=workspace,
   workspacePath=<current workspace path>, name="say hello",
   command="echo hello", notifyLlm=true
2. Create an LLM configuration:
   action=create, type=llm, scope=workspace,
   workspacePath=<current workspace path>, name="code review",
   llmPrompt="Review the recent changes in this workspace"
3. Reuse an existing configuration:
   action=list, query="hello" → find the matching configuration → tell the
   user it is ready to run from the web run-control.`

/**
 * Register the `run-configuration` skill; returns the exact disposer.
 * The argument is typed by the official `ctx.skills.register(skill:
 * SkillRegistration)` from `@deepseek-ai/dsh-skill` (a hard peer alongside the
 * other dsh services this plugin registers into), so a rename or a new
 * required field breaks `tsc` instead of silently drifting.
 * @param ctx - host context with the `skills` service (dsh-base ships it).
 */
export function registerRunConfigurationSkill(ctx: Context): () => void {
  return ctx.skills.register({
    name: RUN_CONFIGURATION_SKILL,
    description: DESCRIPTION,
    whenToUse: WHEN_TO_USE,
    source: 'runtime',
    content: CONTENT,
  })
}
