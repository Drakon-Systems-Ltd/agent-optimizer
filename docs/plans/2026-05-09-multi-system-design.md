# Multi-System Detection + Deep Optimization — Design

**Date:** 2026-05-09
**Status:** Approved for implementation
**Owner:** Michael Kyriacou

## Problem

Agent Optimizer is OpenClaw-only. The audit has matured (22 modules, 100+ checks) but the optimize command still tunes only 5 dimensions (context, heartbeat, subagents, compaction, pruning) across three profiles. Meanwhile Claude Code has the larger user base, shares config DNA with OpenClaw, and is the natural next system to support. The npm package can grow into the "audit any Claude-family system" position without abandoning OpenClaw.

## Goals

1. **Detect** which Claude-family system(s) are present (Claude Code, OpenClaw, later: Cursor) and adapt audit/optimize automatically.
2. **Deep-optimize OpenClaw** — extend `optimize` from 5 dimensions to 17 across the same three profiles, using the latest OpenClaw v2026.4.24 docs.
3. **Add Claude Code support** — detection, ~10 new auditors, profile-based optimization actions.

## Non-goals

- OpenAI ecosystem (Codex, OpenAI Agents SDK, Copilot CLI) — out of scope.
- LangChain / LangGraph / CrewAI / AutoGen — out of scope.
- IDE assistants beyond Cursor (Windsurf, Continue.dev) — out of scope.
- A web dashboard — Phase 2 of monitor subscription, separate doc.

## Release shape

Two ships:

- **v0.10.3** — Refactor + Detection + OpenClaw deep optimize. ~25 new tests, no breaking changes.
- **v0.11.0** — Full Claude Code support (audit + optimize). ~60 new tests.

## Architecture

### Detection (`src/detect/index.ts`)

```ts
export type DetectedSystem = {
  kind: "claude-code" | "openclaw" | "cursor";
  version: string | null;
  configPath: string;       // absolute path to primary config file
  scope: "user" | "project";
};

export function detectSystems(cwd?: string): DetectedSystem[];
```

Fingerprints (checked in this order, all returned):

| System | User fingerprint | Project fingerprint |
|---|---|---|
| Claude Code | `~/.claude/settings.json` exists | `.claude/settings.json` OR `CLAUDE.md` in cwd |
| OpenClaw | `~/.openclaw/openclaw.json` exists | (no project scope) |
| Cursor (v0.11+) | `~/.cursor/` exists | `.cursor/rules/` in cwd |

Version detection per-system (CLI `--version`, fallback to package.json discovery).

### CLI surface

Existing commands unchanged for OpenClaw-only users (back-compat). New:

- `agent-optimizer detect` — lists detected systems, versions, config paths
- `agent-optimizer audit` — auto-runs auditors for every detected system
- `agent-optimizer optimize` — auto-runs optimizer per detected system
- `--system <kind>` — narrow to one when both installed

### Auditor module split

Existing 22 OpenClaw modules move to `src/auditors/openclaw/`. New module trees:

- `src/auditors/claude-code/*.ts` — 10 new modules (Section 2)
- `src/auditors/common/*.ts` — 2 cross-system modules (mcp-overlap, memory-overlap)

Orchestrator `src/auditors/index.ts` dispatches based on `detectSystems()` output. Per-system results grouped in output:

```
Detected: Claude Code v1.0.119 (project + user), OpenClaw v2026.4.24

== Claude Code ==
  ✓ Permissions: 12 checks
  ⚠ Hooks: 3 warnings
  ...

== OpenClaw ==
  ✓ Model Config: 5 checks
  ...

== Cross-system ==
  ⚠ mcp-overlap: "github" defined in both systems with different env
```

## Claude Code auditors (10 modules)

| Module | Coverage |
|---|---|
| **settings-permissions** | Allow/deny conflicts, over-permissive (`Bash(*)`), missing `defaultMode`, empty arrays |
| **settings-hooks** | Event-name validity, regex matcher compiles, per-hook timeout, blocking hooks on every event |
| **settings-env** | Secret leakage, `ANTHROPIC_API_KEY` in user settings (should be keyring), unused vars |
| **settings-statusline** | Statusline command exists + executable, no shell injection in format |
| **settings-model** | Alias validity (opus/sonnet/haiku/inherit), fallback chain, `output_style` references |
| **mcp-servers** | Dead servers, name collisions across scopes, missing env vars, stdio vs http hygiene |
| **slash-commands** | Frontmatter validity, duplicates across scopes, broken `@-references` |
| **skills** | SKILL.md frontmatter, description-as-trigger usability, `allowed-tools` references, resource paths |
| **subagents** | `~/.claude/agents/*.md` frontmatter, name collisions, orphaned subagents |
| **memory-files** | CLAUDE.md size budget, AGENTS.md duplication, broken `@-imports`, recursion |

Cross-system:
- **mcp-overlap** — same MCP server in Claude Code + OpenClaw with divergent shapes
- **memory-overlap** — CLAUDE.md + OpenClaw MEMORY.md competing for same agent's context

## OpenClaw deep optimize (v0.10.3)

Extends `src/optimizers/index.ts` from 5 → 17 dimensions. Each tagged with a profile band:

| Dimension | min | bal | agg |
|---|---|---|---|
| `agents.defaults.contextTokens` (existing) | 500K | 200K | 100K |
| `agents.defaults.heartbeat.every` (existing) | 4h | 6h | 12h |
| `agents.defaults.subagents.maxConcurrent` (existing) | 6 | 4 | 2 |
| `agents.defaults.compaction.model` (existing) | premium | mid | cheap |
| `agents.defaults.contextPruning.ttl` (existing) | 1h | 2h | 30m |
| **`agents.defaults.imageMaxDimensionPx`** | 2000 | 1200 | 800 |
| **`agents.defaults.bootstrapMaxChars`** | 100K | 20K | 10K |
| **`agents.defaults.bootstrapTotalMaxChars`** | 200K | 150K | 100K |
| **`agents.defaults.heartbeat.isolatedSession`** | false | false | true |
| **`agents.defaults.contextPruning.mode = cache-ttl`** | off | on | on |
| **`agents.defaults.model.fallbacks`** | premium-only | premium+mid | premium+mid+cheap |
| **`channels.<provider>.historyLimit`** | 100 | 50 | 20 |
| **`channels.<provider>.mediaMaxMb`** | 100 | 20 | 5 |
| **`channels.<provider>.textChunkLimit`** | 4000 | 4000 | 2000 |
| **`channels.discord.threadBindings.idleHours`** | 48 | 24 | 8 |
| **`channels.modelByChannel`** (suggestions) | none | partial | full mapping |
| **`gateway.channelHealthCheckMinutes` + restartsPerHour** | 2/20 | 5/10 | 10/5 |
| **`tools.profile`** | full | coding | minimal |

`optimize --dry-run` shows the full diff; `optimize` writes with snapshot to `~/.agent-optimizer/rollback/<timestamp>/`.

## Claude Code optimize (v0.11.0)

Profile-based actions (not numeric tuning):

| Action | minimal | balanced | aggressive |
|---|---|---|---|
| CLAUDE.md trim | warn >60K | warn >40K, suggest split | rewrite to ≤20K via extract-to-skill |
| Skills | keep all | disable >30 day unused | disable + description>200ch |
| MCP servers | warn dead | disable dead | disable dead + zero-use 30d |
| Hooks | flag slow | disable >500ms p95 | disable non-critical PreToolUse |
| Permissions | report | suggest tightening `Bash(*)` | auto-tighten from transcripts |
| Subagents | report unused | disable 30-day unused | disable + archive |
| Statusline | report | suggest cheap format | replace with static |

**Activity data source:** `~/.claude/projects/<encoded-cwd>/*.jsonl` transcripts. Grep for tool calls, skill invocations, subagent dispatches in last N days.

**Safety:** when transcripts insufficient, downgrade behavior by one tier (aggressive→balanced) rather than guess. All optimize actions reversible via `agent-optimizer rollback <timestamp>`.

## Implementation phases

1. **Refactor** — move `src/auditors/*.ts` into `src/auditors/openclaw/`. No behavior change. Tests still 236.
2. **Detection** — `src/detect/`, `detect` command, output grouped by system.
3. **OpenClaw deep optimize** — extend optimizer with 12 new dimensions, snapshot existing defaults.
4. **Ship v0.10.3** — README counts, version bump, tag, npm publish, GH release.
5. **Claude Code auditors** — 10 modules + 2 cross-system + ~40 tests.
6. **Claude Code optimize** — activity-based actions + transcript reader + ~20 tests.
7. **Ship v0.11.0** — full Claude Code support live.

## Risks

- **CLAUDE.md trim is destructive** — must always run with diff preview + backup. The "extract-to-skill" aggressive mode probably needs human confirmation, not silent rewrite.
- **Transcript reading is privacy-sensitive** — even though local, document clearly that we read `~/.claude/projects/*.jsonl` and never transmit content (only counts).
- **Detection false positives** — a project may have `CLAUDE.md` but never use Claude Code. Use it as a "possibly Claude Code" signal, not a definitive one. Fall back to `~/.claude/settings.json` for the strong signal.
- **OpenClaw config keys evolve** — the 12 new dimensions are based on v2026.4.24 docs. Future versions may rename keys. Validate every key access and skip cleanly if absent.

## Verification

After each phase, run `npm test -- --run` (must stay green) and `npm run build` (clean tsc). End-to-end:

```bash
agent-optimizer detect       # shows both systems
agent-optimizer audit        # grouped output
agent-optimizer optimize --system openclaw --dry-run --profile aggressive
agent-optimizer optimize --system claude-code --dry-run --profile balanced
```

## References

- Latest OpenClaw docs source: `/Users/michael/Development/openclaw/docs/`
- Claude Code config reference: `~/.claude/` + IDE settings docs
- Existing auditor pattern: [src/auditors/plugins.ts](../../src/auditors/plugins.ts)
- Existing optimizer: [src/optimizers/index.ts](../../src/optimizers/index.ts)
- Brainstorm + docs deep-dive: this session's transcript
