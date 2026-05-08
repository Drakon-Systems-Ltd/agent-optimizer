# 🦞 Agent Optimizer by Drakon Systems

[![npm version](https://img.shields.io/npm/v/@drakon-systems/agent-optimizer?color=cc3534&label=npm)](https://www.npmjs.com/package/@drakon-systems/agent-optimizer)
[![license](https://img.shields.io/badge/license-proprietary-cc3534)](LICENSE.md)
[![tests](https://img.shields.io/badge/tests-236-brightgreen)](https://github.com/Drakon-Systems-Ltd/agent-optimizer)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

**Stop burning money on misconfigured OpenClaw agents.**

Audit, optimize, and secure your OpenClaw deployment. One install, one command, full report. Built from real-world fleet management of 5 AI agents across 4 servers.

**Free to install. Free to audit. Pay only when you want auto-fix.**

**100+ checks. 22 auditor modules. 230+ tests.**

## Install

Works on macOS, Linux, and Windows. Requires Node.js 20+.

```bash
npm install -g @drakon-systems/agent-optimizer
```

No account. No sign-up. No credit card.

## Quick Start

```bash
# Run your first audit (free — no license needed)
agent-optimizer audit

# Preview what optimizations would save you (also free)
agent-optimizer optimize --dry-run

# Scan skills and plugins for malware and hidden billing (also free)
agent-optimizer scan

# Save a golden config baseline
agent-optimizer snapshot save --name golden

# Check for config drift after an update
agent-optimizer drift --name golden
```

## Full Command Reference

### Free Commands (no license needed)

```bash
agent-optimizer audit                              # Full 70+ check audit
agent-optimizer audit --json                       # Machine-readable output
agent-optimizer audit --deep                       # Include live gateway probes
agent-optimizer scan                               # Security scan skills/plugins/hooks
agent-optimizer scan --workspace ~/clawd            # Scan specific workspace
agent-optimizer optimize --dry-run                 # Preview optimization changes
agent-optimizer optimize --dry-run --profile aggressive  # Preview aggressive profile
agent-optimizer drift --name golden                # Compare config against snapshot
agent-optimizer snapshot save --name golden        # Save config baseline
agent-optimizer snapshot list                      # List saved snapshots
agent-optimizer license                            # Show license status
agent-optimizer update                             # Check for updates
agent-optimizer buy                                # Open purchase page in browser
agent-optimizer buy --tier solo                    # Pre-select Solo tier
```

### Licensed Commands (Solo £29+)

```bash
agent-optimizer audit --fix                        # Auto-apply safe fixes
agent-optimizer optimize                           # Apply balanced optimizations
agent-optimizer optimize --profile aggressive      # Maximum token savings
agent-optimizer optimize --only heartbeat          # Fix only heartbeat
agent-optimizer optimize --only context,pruning    # Fix specific areas
agent-optimizer optimize --skip subagents          # Fix everything except subagents
agent-optimizer rollback                           # Restore pre-optimize backup
agent-optimizer activate AO-XXXX-XXXXXXXX-XXXXXXXX # Activate license
agent-optimizer deactivate                         # Remove license
```

### Fleet Commands (Fleet £79+ / Lifetime £149)

```bash
agent-optimizer fleet --hosts jarvis,edith,tars    # Audit entire fleet via SSH
agent-optimizer fleet --hosts jarvis,edith --json  # Fleet audit as JSON
```

## What's Free vs Paid

| Command | Free | Solo (£29) | Fleet (£79) | Lifetime (£149) |
|---------|------|------------|-------------|-----------------|
| `audit` (70+ checks) | Results + 3 fixes | All fixes | All fixes | All fixes |
| `audit --fix` | Shows issues | Auto-fixes | Auto-fixes | Auto-fixes |
| `scan` (28 patterns) | Full results | Full results | Full results | Full results |
| `optimize --dry-run` | Preview | Preview | Preview | Preview |
| `optimize` | Preview only | Applies changes | Applies changes | Applies changes |
| `drift` | Full results | Full results | Full results | Full results |
| `snapshot` | Save & list | Save & list | Save & list | Save & list |
| `fleet --hosts` | - | - | SSH fleet audit | SSH fleet audit |
| `rollback` | - | Yes | Yes | Yes |
| Updates | - | 12 months | 12 months | 12 months |
| Priority support | - | - | - | Yes |

The free audit shows every issue and the first 3 fix instructions. A license unlocks all fix instructions, auto-fix, and optimization profiles.

## What It Audits

| Auditor | Checks |
|---------|--------|
| **Model Config** | Primary model, fallback diversity, cross-provider redundancy, thinkingDefault, legacy alias detection, thinking mode compatibility, unknown keys |
| **Auth Profiles** | Token expiry, duplicate keys, provider coverage, placeholder credential detection (.env) |
| **Cost Estimator** | Monthly spend estimate, savings projection, expensive fallback warnings, subscription/self-hosted detection (LM Studio, Codex, Ollama, GitHub Copilot) |
| **Token Efficiency** | Context window sizing, heartbeat frequency, subagent concurrency, compaction, pruning |
| **Cache Efficiency** | cacheRetention config, heartbeat vs cache TTL alignment, lightContext, compaction model cost |
| **Bootstrap Files** | Per-file size vs 20K limit, total vs 150K budget, truncation warnings, missing SOUL/IDENTITY |
| **Security Scanner** | 28 patterns: billing, injection, obfuscation, exfiltration. Per-skill scoring. Provenance detection |
| **Plugins** | Stale installs, allowlist gaps, orphaned entries, bundled plugin recognition (memory-wiki, dreaming, active-memory, etc.) |
| **Legacy Overrides** | Codex transport override, hardcoded API keys in models.json, allowPrivateNetwork validation |
| **Tool Permissions** | Allow/deny conflicts, elevated channel restrictions |
| **Provider Failover** | Chain depth, provider diversity, auth coverage, cost escalation, latency risk |
| **Channel Security** | DM/group policies, allowlist gaps, mutable ID warnings |
| **Memory Search** | Embedding provider, hybrid search weights, embedding cache, sqlite-vec acceleration, dreaming, active memory, QMD backend |
| **Local Models** | localModelLean recommendation, context window vs model capacity, compaction reserve overflow, subagent/heartbeat limits, fallback resilience |
| **Hooks Deprecations** | Flags legacy `hooks.internal.handlers[]` array format and the deprecated `before_agent_start` event |
| **Hook Events** | Validates hook event names against the v2026.3.14 schema — typos that would silently never fire are caught at audit time |
| **Config Patch Usage** | Scans hooks and agent `tool.alsoAllow` for `config.patch` / `config.apply` references that v2026.4.23 fails closed on |
| **Dreaming Cron** | Reads `~/.openclaw/cron/jobs.json` and flags stale main-session dreaming jobs (v2026.4.23 decoupled dreaming from heartbeat) |
| **Pairing CIDRs** | Validates `gateway.nodes.pairing.autoApproveCidrs` — flags `0.0.0.0/0`, public ranges, and overly wide private ranges that would auto-approve untrusted nodes |
| **Sandbox Backends** | Validates `tools.sandbox.backend` (openshell / ssh / none / off) and SSH backend files (key, cert, known\_hosts) |
| **Exec Approvals** | Flags malformed `~/.openclaw/exec-approvals.json` and approvals older than 90 days still active |
| **Tools / byProvider** | Unknown profile names (`minimal` / `coding` / `default`), allow/deny conflicts per provider, empty provider keys |
| **Security Advisories** | Version-aware checks against 16 known issues from v2026.4.12–4.24 (config.patch bypass, secret leaks, symlink traversal, SSRF, timing attacks, registerEmbeddedExtensionFactory removal) |

## Optimize Profiles

```bash
agent-optimizer optimize --profile minimal         # Light touch
agent-optimizer optimize --profile balanced        # Recommended (default)
agent-optimizer optimize --profile aggressive      # Maximum savings
```

| Profile | Context | Heartbeat | Subagents | Pruning TTL |
|---------|---------|-----------|-----------|-------------|
| minimal | 500K | 4h | 6 | 1h |
| balanced | 200K | 6h | 4 | 2h |
| aggressive | 100K | 12h | 2 | 30m |

Use `--only` and `--skip` to cherry-pick:

```bash
agent-optimizer optimize --only heartbeat,pruning  # Just these two
agent-optimizer optimize --skip context            # Everything except context
```

Tags: `context`, `heartbeat`, `subagents`, `compaction`, `pruning`

## Config Drift Detection

Save a known-good config as a baseline, then check for drift after updates:

```bash
# After setting up your agent perfectly
agent-optimizer snapshot save --name golden

# After an openclaw update or config change
agent-optimizer drift --name golden
```

Tracks 15+ config fields including model, fallbacks, context, heartbeat, compaction, plugins, and tool permissions. Flags critical changes to model selection and plugin allowlists.

## Security Advisories

Agent Optimizer auto-detects your OpenClaw version and checks against known security issues:

```
Security
  ✓ OpenClaw version: Detected OpenClaw 2026.4.12
  ✗ config.patch gateway bypass: config.patch callable from gateway tool — allows remote config modification
  ✗ Approval prompt secret leak: Secrets visible in exec approval prompts
  ✗ Workspace symlink traversal: agents.files.get/set don't prevent symlink-swap attacks
  ⚠ Bearer timing attack: Gateway /mcp bearer uses plain !== comparison
  ⚠ Memory path traversal: QMD backend allows reads of arbitrary workspace paths
  ✗ Advisory summary: 12 advisories (3 critical, 9 warnings) — upgrade to v2026.4.15+
```

Covers 16 known issues across v2026.4.12 through v2026.4.24, including the v2026.4.24 removal of `api.registerEmbeddedExtensionFactory()` that breaks plugins still using the old extension API.

## Licensing

```bash
agent-optimizer license                            # Check status
agent-optimizer activate AO-FLEE-A1B2C3D4-E5F6G7H8 # Activate
agent-optimizer deactivate                         # Remove
```

Purchase at [drakonsystems.com/products/agent-optimizer](https://drakonsystems.com/products/agent-optimizer).

Licenses are RSA-signed and verified offline — no phone-home, no telemetry, no account required. The only network call is the one-time activation.

Lost your key? [Retrieve it here](https://drakonsystems.com/products/agent-optimizer/license/retrieve).

## Example Output

```
🔍 Drakon Systems — Agent Optimizer

Model Config
  ✓ Primary model set: Primary: openai-codex/gpt-5.4
  ✓ Cross-provider fallback: Fallbacks include multiple providers

Cost Estimate
  ✓ Primary model cost: openai-codex/gpt-5.4 uses subscription — no per-token cost

Provider Failover
  ✓ Fallback depth: 4 fallback models configured
  ✓ Provider diversity: 4 providers
  ⚠ Auth: anthropic:claude-cli: OAuth token expired 25h ago

Token Efficiency
  ⚠ Heartbeat: 1h = ~24 turns/day of idle token burn

Cache Efficiency
  ✓ cache-ttl pruning enabled (TTL: 2h)
  ✓ Compaction model: claude-cli/claude-sonnet-4-6

Bootstrap Files
  ✓ SOUL.md: 4.4K chars (22% of limit)
  ✓ TOOLS.md: 0.9K chars (4% of limit)
  ✓ Total: 13.2K chars (9% of 150K budget)

Memory Search
  ✓ Embedding provider: openai
  ✓ Hybrid weights: 0.7 vector / 0.3 text
  ✓ Dreaming enabled (schedule: 0 3 * * *)

Security
  ✓ OpenClaw version: Detected OpenClaw 2026.4.15
  ✓ No known security advisories for this version

Channel Security
  ⚠ No default DM policy set

─── Summary ───
  28 pass  8 warn  1 fail  Total: 52

🦞 Found 1 critical and 8 warnings. Want to fix them automatically?
   Run: agent-optimizer optimize to preview changes (free)
   Run: agent-optimizer audit --fix to auto-apply (requires license)
```

## Development

```bash
npm install
npx tsx src/cli.ts audit              # Run without building
npm run build                          # Compile TypeScript
npm test                               # Run tests (130 passing)
```

## License

Proprietary. See [LICENSE.md](LICENSE.md).

Copyright (c) 2026 Drakon Systems Ltd.

---

🦞 Built by [Drakon Systems](https://drakonsystems.com) — from the team that runs AI fleets in production.
