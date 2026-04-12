# Architecture

## Overview

Agent Optimizer is a CLI tool that reads OpenClaw configuration files, runs a suite of
auditors against them, and produces actionable reports. It can also apply optimizations
and scan for security issues in installed skills/plugins.

```
┌──────────────────────────────────────────────────┐
│                    CLI (cli.ts)                   │
│         commander-based command routing           │
├──────────┬───────────┬───────────┬───────────────┤
│  audit   │ optimize  │   scan    │    fleet      │
└────┬─────┴─────┬─────┴─────┬─────┴───────┬───────┘
     │           │           │             │
     ▼           ▼           ▼             ▼
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐
│Auditors │ │Optimizer│ │Security │ │Fleet SSH │
│ Suite   │ │ Engine  │ │ Scanner │ │  Audit   │
└────┬────┘ └────┬────┘ └────┬────┘ └────┬─────┘
     │           │           │           │
     ▼           ▼           ▼           ▼
┌──────────────────────────────────────────────────┐
│              Utils (config.ts)                    │
│    Config loading, path expansion, parsing        │
├──────────────────────────────────────────────────┤
│              Types (types.ts)                     │
│    OpenClawConfig, AuditResult, AuthProfiles      │
└──────────────────────────────────────────────────┘
```

## Directory Structure

```
src/
├── cli.ts                    # Entry point, command definitions
├── types.ts                  # All TypeScript interfaces
├── utils/
│   └── config.ts             # Config loading, path helpers
├── auditors/
│   ├── index.ts              # Audit orchestrator
│   ├── model-config.ts       # Model/fallback/thinking validation
│   ├── auth-profiles.ts      # Token expiry, duplicate keys, coverage
│   ├── token-efficiency.ts   # Context size, heartbeat, compaction
│   ├── plugins.ts            # Plugin allowlist, stale installs
│   ├── legacy-overrides.ts   # Codex transport, hardcoded keys
│   ├── tool-permissions.ts   # Allow/deny conflicts, elevated config
│   ├── security-scan.ts      # Skill/plugin/hook malware scanning
│   └── fleet.ts              # Multi-host SSH audit
├── optimizers/
│   └── index.ts              # Profile-based config optimization
└── reporters/
    └── index.ts              # Terminal and JSON output formatting
```

## Module Responsibilities

### Auditors

Each auditor is a pure function: `(config, context?) → AuditResult[]`

| Module | What It Checks | Reads |
|--------|---------------|-------|
| `model-config` | Primary model, fallbacks, thinkingDefault, unknown keys | `openclaw.json` |
| `auth-profiles` | Token expiry, duplicates, provider coverage | `auth-profiles.json` |
| `token-efficiency` | Context window, heartbeat, subagents, compaction, pruning | `openclaw.json` |
| `plugins` | Allowlist gaps, stale installs, orphaned entries | `openclaw.json` |
| `legacy-overrides` | Codex api/baseUrl, hardcoded keys in models.json | `models.json` |
| `tool-permissions` | Allow/deny conflicts, elevated channel config | `openclaw.json` |
| `security-scan` | Billing patterns, eval, HTTP calls, shell exec | Workspace files |
| `fleet` | Per-host config, gateway status, legacy overrides | SSH + remote JSON |

### Optimizer

Takes a profile (`minimal`, `balanced`, `aggressive`) and generates a list of
`Optimization` objects. Each optimization maps a config path to a recommended value
with a reason. Can apply changes with automatic backup.

### Reporter

Formats `AuditReport` for terminal (grouped by category, color-coded status icons)
or JSON output. Summary includes pass/warn/fail counts.

## Data Flow

```
1. CLI parses command + options
2. Config loaded from disk (openclaw.json)
3. Agent dir resolved (from config or default)
4. Auditors run in sequence, each returning AuditResult[]
5. Results aggregated into AuditReport
6. Reporter formats and displays
7. If --fix: auto-fixable results applied, config written back
```

## Key Design Decisions

### Pure auditor functions
Each auditor takes config as input and returns results — no side effects. This makes
them testable, composable, and safe to run in any order.

### Profiles over knobs
The optimizer uses named profiles instead of individual toggles. Users pick a strategy
(`minimal`, `balanced`, `aggressive`), not individual values. This prevents half-configured
states.

### Security scan by pattern matching
The security scanner uses regex patterns against file contents rather than AST parsing.
This is fast, language-agnostic, and catches patterns across Python, JavaScript, TypeScript,
and shell scripts. Trade-off: higher false positive rate, but we prefer false positives
over missed billing/malware.

### Fleet via SSH
Fleet audit uses `ssh <host>` with `cat` to read remote configs. No agent, no daemon,
no custom protocol. Works with any SSH config and requires no installation on remote hosts.

## File Formats

### openclaw.json
Main OpenClaw configuration. Contains `agents.defaults` (model, compaction, heartbeat,
etc.) and `agents.list` (per-agent tools/permissions). Also `plugins` (allow, entries,
installs).

### auth-profiles.json
Located in the agent directory. Contains provider credentials — API keys, OAuth tokens
with expiry timestamps, refresh tokens.

### models.json
Located in the agent directory. Provider-level model definitions, API endpoints, and
(sometimes) hardcoded API keys. Legacy transport overrides live here.

## Extending

### Adding a new auditor

1. Create `src/auditors/my-check.ts`
2. Export a function: `(config: OpenClawConfig, agentDir?: string) => AuditResult[]`
3. Import and add to the pipeline in `src/auditors/index.ts`

### Adding a new suspicious pattern

Add to the `SUSPICIOUS_PATTERNS` array in `src/auditors/security-scan.ts`:

```typescript
{ pattern: /your-regex/i, label: "Description of what this catches" }
```

### Adding a new optimization

Add to the `getOptimizations` function in `src/optimizers/index.ts`. Each optimization
needs a `path`, `current`, `recommended`, and `reason`.

## Dependencies

| Package | Purpose | License |
|---------|---------|---------|
| commander | CLI framework | MIT |
| chalk | Terminal colors | MIT |
| ora | Spinners (future) | MIT |
| typescript | Build | Apache-2.0 |
| tsx | Dev runtime | MIT |
| vitest | Testing | MIT |
