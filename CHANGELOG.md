# Changelog

All notable changes to Agent Optimizer are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Documentation

- README "Development" now states the Node.js range the locked dev toolchain
  needs (`^20.19.0 || ^22.12.0 || >=24.0.0`, Node 22 recommended to match CI),
  separate from runtime support (still Node 20+), and gives `npx vitest run`
  as the one-shot test command (`npm test` is watch mode).

## [0.15.1]

### Security

- **License validation can no longer be bypassed with an unsigned or edited
  `license.json`.** Previously the RSA check only ran when the stored
  `signature` contained a `.`, so an empty or non-JWT signature with
  `expiresAt: null` was accepted as a valid license of any tier, and tier and
  expiry were always read from the unsigned `data` fields even when a genuine
  token was present. Now every license must carry an RS256 token
  (`alg: RS256`, `typ: JWT`, `product: agent-optimizer`) that verifies against
  the embedded public key, with well-formed `tier`, `email`, `issued_at` and
  `expires_at` claims. Entitlement (Fleet access) and expiry come from the
  signed claims; the `data` sidecar must match the signed tier and email, and
  its expiry can only shorten validity. `activate` verifies the server's
  response before saving it. Genuine licenses issued by
  drakonsystems.com are unaffected; hand-made or edited license files stop
  working.

### Fixed

- `deactivate` no longer crashes with `require is not defined` (the license
  store called CommonJS `require` from an ES module).
- A corrupt or non-object `license.json` is treated as "no license" instead of
  crashing `agent-optimizer license`.

## [0.15.0]

The **September drift** release: current to OpenClaw v2026.9.4 and Hermes
Agent 0.21.2 (a.k.a. v2026.9.11 — Hermes now carries both version schemes).

### Added

- **30 new OpenClaw security advisories (72 total, v2026.4.12–2026.9.3).**
  Every OpenClaw GitHub Security Advisory published on 2026-09-11 whose
  patched version is 2026.8.1, 2026.8.2, 2026.8.11 or 2026.9.3 (21 entries),
  plus the nine 2026.7.1-patched GHSAs the table was missing. Each check name
  carries its GHSA id (e.g. `Codex native tools per-chat policy
  (GHSA-wwcw-jfpp-gpxw)`) so it can be looked up; high/critical map to
  **fail**, medium/low to **warn**. Advisory data is now current to
  v2026.9.4, so 2026.8.x / 2026.9.x installs no longer get the "data may be
  behind" note.
- **OpenClaw 2026.9.4 doctor migrations in the Legacy Config auditor.**
  `channels.telegram.requireMention` and `routing.groupChat.requireMention`
  (→ `channels.<channel>.groups."*".requireMention`),
  `routing.groupChat.historyLimit/mentionPatterns` (→ `messages.groupChat.*`),
  `routing.allowFrom`, `channels.webchat`, `tools.web.search.apiKey`
  (→ `plugins.entries.<provider>.config.webSearch.apiKey`),
  `tools.web.fetch.firecrawl` (→ `plugins.entries.firecrawl.config.webFetch`),
  `tools.web.x_search.apiKey` (→ `plugins.entries.xai.config.webSearch.apiKey`),
  retired `tools.web.x_search.model` values, retired `messages.queue.mode` /
  `byChannel` values (`queue`, `steer-backlog`, `steer+backlog`),
  `messages.tts`, `tts.enabled`, `session.threadBindings.ttlHours` /
  `spawnSubagentSessions` / `spawnAcpSessions`, `session.typingMode`,
  `session.maintenance.rotateBytes`, `session.parentForkMaxTokens`,
  `session.resetByType.dm`, `cron.webhook`, `cron.runLog`, `agents.list`,
  `agents.defaults.sandbox.perSession` / `model.timeoutMs` /
  `silentReply.direct` / `memorySearch` / `systemPromptOverride`,
  `gateway.bind` host aliases, `gateway.tailscale.resetOnExit` /
  `serviceName`, `gateway.controlUi.dangerouslyDisableDeviceAuth` /
  `toolTitles`, `skills.workshop.autonomous.enabled` /
  `allowSymlinkTargetWrites`, `plugins.entries.codex-supervisor` /
  `openai-codex`, `diagnostics.otel.protocol: grpc`,
  `bindings[].match.peer.kind: dm`, `channels.feishu.accounts.<id>.botName`
  and top-level `crestodian`. Messages mirror the upstream doctor rules.
- **Hook Events** recognises `session:auto-reset` (new in v2026.9). The
  registry now matches `KNOWN_INTERNAL_HOOK_EVENT_KEYS` in OpenClaw 2026.9.4.
  `gateway:agent` is deliberately still flagged: upstream uses it only as a
  `commandSource` value, never as an event key, so a subscription to it would
  silently never fire.
- **Hermes named profiles.** The Hermes runner discovers
  `<hermes-home>/profiles/<name>/` and runs the whole auditor family against
  each live profile's `config.yaml` + `auth.json`, labelling findings
  `[profile <name>] …`. Dot-directories and profiles tombstoned by
  `hermes profile delete` (`profiles/.deleted/<name>`) are skipped, matching
  Hermes' own loader. Still read-only.
- **Hermes config schema version check.** Reads `_config_version`; a value
  below Hermes' auto-migration support floor (v12) **warns** that Hermes will
  not auto-migrate the file (retired keys persist silently) and gives the
  upstream remedy; an in-support but stale version is an info note; v44 (the
  0.21.2 schema) passes. Absent = fresh config, no finding.
- **Hermes removed-key warnings** from config migrations 38+:
  `cron.model_drift_guard` (v42), `gateway.multiplex_profile_allowlist` (v43)
  and the removed Relay plugin in `plugins.enabled` (`nemo_relay`,
  `observability/nemo_relay`, v38), each with the upstream migration reason.
- `HERMES_HOME` is honoured when locating the Hermes config.

### Changed

- **Hermes version detection** understands both schemes — `0.21.2` and
  `v2026.9.11` — and reports the semver form when `hermes --version` prints
  both.
- Top-level `memorySearch` now points at its 2026.9.4 target `memory.search`
  (was `agents.defaults.memorySearch`, itself now a legacy location).
  Legacy web-search provider findings name the owning plugin
  (`grok` → `xai`, `gemini` → `google`, `kimi` → `moonshot`).
- Bundled OpenClaw plugin: built against OpenClaw 2026.9.4.

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
