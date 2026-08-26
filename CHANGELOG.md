# Changelog

All notable changes to Agent Optimizer are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.14.0]

The **Hermes + honest-report** release: read-only Hermes Agent support, and a
report that gives every user the full picture for free.

### Added

- **Hermes Agent support (read-only).** Detects `~/.hermes/config.yaml` and runs
  a dedicated auditor family: model/fallback chain, approvals + command
  allowlist, prompt caching, compression, memory write-approval, per-channel
  allowlists (correct per-channel keys: `allowed_chats` / `allowed_channels` /
  `allowed_rooms`, with `require_mention` treated as a gate), PII redaction,
  inline-shell + agent-created-skill guards, and auth token expiry from
  `auth.json`. Headline check: the known `hermes config set` defect where a
  list-valued key is silently stored as one quoted string (and `hermes config
  check` still reports healthy) is caught and FAILed with the exact repair
  command. `~/.hermes/skills` is included in `scan`. No writes — `optimize`
  and `--fix` stay OpenClaw/Claude Code-only for now.
- **Hermes-only boxes audit cleanly.** A missing OpenClaw config no longer
  aborts the audit when another agent system was detected.
- `audit -v/--verbose` to show all informational notes.

### Changed

- **All fix advice is now free.** The licensed feature is `--fix` *applying*
  fixes, not seeing them. The upsell now reports how many findings are
  auto-fixable instead of hiding instructions.
- **Deduplicated human report.** Identical (status, message) rows across
  auditors are shown once with an "also flagged by N other checks" note.
  `--json` output is unchanged.
- **Collapsed info notes.** Cost Estimate notes stay visible; the rest fold
  into a count unless `--verbose`. 
- **Honest health score.** Info rows no longer count as passes — score is
  computed over pass/warn/fail only (a box with dead primary auth dropped
  from 89 to 82).
- **Multi-agent branding.** Description, help, and npm keywords now cover
  Claude Code, OpenClaw, and Hermes.
- **Zero-arg default.** Bare `agent-optimizer` (or
  `npx @drakon-systems/agent-optimizer`) runs the audit instead of printing
  help.

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
