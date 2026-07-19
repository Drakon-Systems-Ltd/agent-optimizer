# Changelog

All notable changes to Agent Optimizer are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.13.0]

The **agent loop** release: Agent Optimizer becomes safely drivable by an LLM host
agent (an OpenClaw claw agent or Claude Code), end to end, with a hard human-approval
gate on every mutation.

### Added

- **Agent loop machine contract.** `audit --json`, `scan --json`, `optimize --plan`,
  `optimize --apply-plan`, and `rollback --json` all emit **pure JSON on stdout**
  (the banner goes to stderr, so piping to `jq` works). Every payload carries a
  `schemaVersion`; findings carry **stable `id`s** (branch on the `id`, never the
  English `message`), a **`machineFixable`** flag (`true` ⟺ `audit --fix` can
  auto-apply it), and an **`untrusted`** flag. Apply failures return a distinct
  error `slug` + exit code so a host agent branches on the class, not the text.
- **`optimize --plan` / `optimize --apply-plan`.** `--plan` builds and persists a
  machine-readable plan (free, read-only) that pins a content hash of the config
  and every `$include`d fragment. `--apply-plan <id>` applies exactly the
  human-approved subset (`--only <proposalIds>`), transactionally, behind a
  config-drift staleness guard.
- **Transactional apply engine.** A backup → mutate → verify → auto-rollback engine
  guards every write to a live config: multi-generation backups under
  `~/.agent-optimizer/backups/`, a post-apply re-verify, and automatic revert to the
  exact pre-apply bytes if the change fails to parse or regresses the auditors past
  the pre-apply baseline. A directory lockfile serializes all applies. `audit --fix`
  and `optimize` apply both route through it.
- **`scan --json` / `rollback --json`.** Structured, agent-facing output:
  `rollback --list` / `--to <id>` over the multi-generation backup store, and a
  security scan report with per-finding ids and the untrusted flag.
- **Injection-safe scanner.** `scan` results that quote third-party skill/plugin/hook
  content are passed through an untrusted-content sanitizer and marked
  `untrusted: true`, so quoted content is surfaced strictly as **data, never
  instructions**.
- **Bundled OpenClaw plugin + one-command install.** The `openclaw-plugin/` build
  now ships inside the npm package, and a new `agent-optimizer plugin install
  [--enable]` command copies the loadable plugin (`openclaw.plugin.json`,
  `package.json`, `dist/index.js`) into `~/.openclaw/extensions/agent-optimizer/`.
  The plugin exposes five agent tools — `optimizer_audit`, `optimizer_plan`,
  `optimizer_apply`, `optimizer_rollback`, `optimizer_scan` — of which the two
  mutating tools (`optimizer_apply`, `optimizer_rollback`) are **approval-gated**
  (allow-once / deny) via a fail-closed `before_tool_call` hook. `--enable` adds
  `"agent-optimizer"` to `plugins.allow` **through the transactional engine**, so
  even enabling is backed up, verified, and auto-rolled-back on failure.

## [0.12.0]

- Updated auditors and optimizers to OpenClaw **v2026.7.1**: SQLite auth-profile
  store, JSON5 + `$include` config parsing, corrected sandbox backends
  (`docker` / `ssh`), refreshed `tools.profile` / `thinkingDefault` enums, and
  updated model ids and pricing.

## [0.11.0]

- Added Claude Code auditors alongside the OpenClaw auditors (multi-system audit).

---

Earlier releases (0.7.x–0.11.x) are recorded as git tags in the repository.

[0.13.0]: https://github.com/Drakon-Systems-Ltd/agent-optimizer/releases/tag/v0.13.0
[0.12.0]: https://github.com/Drakon-Systems-Ltd/agent-optimizer/releases/tag/v0.12.0
[0.11.0]: https://github.com/Drakon-Systems-Ltd/agent-optimizer/releases/tag/v0.11.0
