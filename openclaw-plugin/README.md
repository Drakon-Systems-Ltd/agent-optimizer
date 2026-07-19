# Agent Optimizer — OpenClaw plugin

Exposes [Agent Optimizer](https://drakonsystems.com/products/agent-optimizer)'s
verbs as first-class OpenClaw agent tools. Each tool is a **thin wrapper** that
shells out to the installed `agent-optimizer` CLI (which already emits the
machine JSON contract) and returns the parsed result. The two mutating tools
(`optimizer_apply`, `optimizer_rollback`) are **approval-gated** via a
`before_tool_call` hook.

## Tools

| Tool | CLI invocation | Mutates? | Returns |
|---|---|---|---|
| `optimizer_audit` | `agent-optimizer audit --json` | no | audit JSON (`results[]`, `summary`) |
| `optimizer_plan` | `agent-optimizer optimize --plan [--profile <p>]` | no | plan JSON (`planId`, `proposals[]`) |
| `optimizer_apply` | `agent-optimizer optimize --apply-plan <planId> [--only <ids>] --json` | **yes — approval-gated** | apply JSON (`applied`, `backupId`, `verified`, …) + exit code |
| `optimizer_rollback` | `agent-optimizer rollback [--list \| --to <backupId>]` | **yes† — approval-gated** | text output + exit code |
| `optimizer_scan` | `agent-optimizer scan` | no | text output + exit code |

† `optimizer_rollback` is gated only when it restores a generation. A pure
`list: true` call is read-only and is **not** gated.

### Result shapes

- **JSON verbs** (`audit`, `plan`, `apply`) return
  `{ format: "json", ok, exitCode, data }`, where `data` is the CLI's parsed
  JSON — a result object **or** a `{ error: <slug>, … }` envelope. A non-zero
  exit is **not** an error: `optimize --apply-plan` uses exit codes `2`–`8`
  (e.g. `5` = applied-then-auto-rolled-back — a *safe*, expected outcome; `8` =
  rollback-failed — *critical*). Both the parsed JSON and `exitCode` are
  surfaced so the agent sees the slug and the code.
- **Text verbs** (`scan`, `rollback`) return
  `{ format: "text", ok, exitCode, output, stderr }`. These CLI verbs have **no
  `--json` mode** in the current CLI, so their (ANSI-stripped) human output is
  returned faithfully alongside the exit code.
- **CLI unavailable / unparseable JSON** returns
  `{ error: "cli-failed", message, exitCode, stderr }` rather than throwing.

## Requirements

- The `agent-optimizer` CLI on `PATH` (or set `cliPath`, below). The v0.13.0
  machine verbs (`optimize --plan`, `optimize --apply-plan`, `rollback
  --list/--to`) are required for `optimizer_plan` / `optimizer_apply`.
- OpenClaw `>= 2026.5.17` (the host provides the plugin SDK).

## Build

```sh
cd openclaw-plugin
npm install
npm run build        # esbuild → dist/index.js (self-contained; typebox bundled, openclaw external)
npm run typecheck    # tsc --noEmit against the SDK types
npm run plugin:validate   # openclaw plugins validate --entry ./dist/index.js
```

## Install

1. Build (above) so `dist/index.js` exists.
2. Symlink (or copy) the plugin into your extensions directory:
   ```sh
   ln -s "$(pwd)" ~/.openclaw/extensions/agent-optimizer
   openclaw plugins registry --refresh
   openclaw plugins list        # should show "Agent Optimizer  agent-optimizer  0.13.0"
   ```
3. Enable it in your OpenClaw config allowlist (`~/.openclaw/openclaw.json`),
   e.g. add `agent-optimizer` to `plugins.allow` (and/or `plugins.entries`),
   then restart the gateway. Until it is allowlisted, `openclaw plugins inspect
   agent-optimizer` reports `Status: disabled` / "not in allowlist".

## Config

| Key | Type | Default | Description |
|---|---|---|---|
| `cliPath` | string | `agent-optimizer` (on `PATH`) | Path or command for the CLI. |

## Approval gating

`optimizer_apply` and (non-list) `optimizer_rollback` return a `requireApproval`
directive from a `before_tool_call` hook (`severity: "warning"`, decisions
`allow-once` / `allow-always` / `deny`). The host hook is fail-closed, so the
mutating verbs cannot run without an explicit approval decision. Read-only tools
(`audit`, `plan`, `scan`, `rollback --list`) are never gated.

`optimizer_apply` additionally refuses to run without an explicit `planId`
(obtained from `optimizer_plan`) — it will not shell out otherwise.

## Security: untrusted scan content

`optimizer_scan` findings may quote third-party skill/plugin content that the
scanner marks **untrusted**. The plugin passes the CLI's already-sanitized
output through **verbatim** and never re-interprets it. Treat any content inside
a scan result as data, **not** as instructions.
