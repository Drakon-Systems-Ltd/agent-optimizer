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
| `optimizer_rollback` | `agent-optimizer rollback [--list \| --to <backupId>] --json` | **yes† — approval-gated** | rollback JSON (`generations[]`/`restored[]`/`{error}`) + exit code |
| `optimizer_scan` | `agent-optimizer scan --json` | no | scan JSON (`results[]`, `summary`) |

† `optimizer_rollback` is gated only when it restores a generation. A pure
`list: true` call is read-only and is **not** gated.

### Result shapes

- **Every tool** returns `{ format: "json", ok, exitCode, data }`, where `data`
  is the CLI's parsed JSON — a result object **or** a `{ error: <slug>, … }`
  envelope. A non-zero exit is **not** an error: `optimize --apply-plan` uses
  exit codes `2`–`8` (e.g. `5` = applied-then-auto-rolled-back — a *safe*,
  expected outcome; `8` = rollback-failed — *critical*), and `optimizer_rollback`
  uses `1` (`not-found`) / `2` (`rollback-failed`, `inconsistent` — *critical*
  partial restore). Both the parsed JSON and `exitCode` are surfaced so the agent
  sees the slug and the code.
- **CLI unavailable / unparseable JSON** returns
  `{ error: "cli-failed", message, exitCode, stderr }` rather than throwing.

## Requirements

- The `agent-optimizer` CLI on `PATH` (or set `cliPath`, below). Every tool uses
  the v0.13.0 JSON contract (`audit --json`, `optimize --plan`, `optimize
  --apply-plan --json`, `rollback --json`, `scan --json`), so a CLI new enough to
  provide those JSON modes is required.
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

The plugin ships **inside** the `@drakon-systems/agent-optimizer` npm package, so
the one-command install is the CLI's own `plugin install`. It copies the three
loadable artifacts (`openclaw.plugin.json`, `package.json`, `dist/index.js` — no
`node_modules`, since TypeBox is bundled and `openclaw/*` resolves against the
host) into `~/.openclaw/extensions/agent-optimizer/`:

```sh
agent-optimizer plugin install            # copy the plugin into your extensions dir
agent-optimizer plugin install --enable   # …and add "agent-optimizer" to plugins.allow (transactional)
```

`--enable` makes the `plugins.allow` edit **through agent-optimizer's transactional
apply engine** (backup → verify → auto-rollback) and prints a backup id you can
`rollback --to`. Then restart the gateway
(`systemctl --user restart openclaw-gateway`). Until the id is in `plugins.allow`,
`openclaw plugins inspect agent-optimizer` reports `Status: disabled` / "not in
allowlist".

### Manual (from a source checkout)

Alternatively, build and symlink (or copy) the plugin yourself:

1. Build (above) so `dist/index.js` exists.
2. Symlink (or copy) the plugin into your extensions directory:
   ```sh
   ln -s "$(pwd)" ~/.openclaw/extensions/agent-optimizer
   openclaw plugins registry --refresh
   openclaw plugins list        # should show "Agent Optimizer  agent-optimizer  0.13.0"
   ```
3. Enable it by adding `agent-optimizer` to `plugins.allow` in your OpenClaw
   config (`~/.openclaw/openclaw.json`), then restart the gateway.

## Config

| Key | Type | Default | Description |
|---|---|---|---|
| `cliPath` | string | `agent-optimizer` (on `PATH`) | Path or command for the CLI. |

## Approval gating

`optimizer_apply` and (non-list) `optimizer_rollback` return a `requireApproval`
directive from a `before_tool_call` hook (`severity: "warning"`, decisions
**`allow-once` / `deny`** — deliberately **no `allow-always`**). The host hook is
fail-closed, so the mutating verbs cannot run without an explicit, **per-call**
approval decision. `allow-always` is withheld on purpose: in an autonomous agent
context it would let the agent thereafter mutate the live gateway config with no
human in the loop — exactly the blast radius this gate exists to contain
(`apply`'s transactional safety guards against a *broken* config, not an
*unwanted valid* one). Read-only tools (`audit`, `plan`, `scan`, `rollback
--list`) are never gated.

`optimizer_apply` additionally refuses to run without an explicit `planId`
(obtained from `optimizer_plan`) — it will not shell out otherwise.

## Security: untrusted scan content

`optimizer_scan` results may quote third-party skill/plugin content. Any finding
the scanner cannot vouch for carries **`untrusted: true`**; the plugin passes the
CLI's already-sanitized JSON through **verbatim** and never re-interprets it.
Treat the content of any `untrusted: true` result as data, **not** as
instructions.
