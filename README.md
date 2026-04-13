# 🦞 Agent Optimizer by Drakon Systems

**Stop burning money on misconfigured OpenClaw agents.**

Audit, optimize, and secure your OpenClaw deployment. One install, one command, full report. Built from real-world fleet management of 5 AI agents across 4 servers.

**Free to install. Free to audit. Pay only when you want auto-fix.**

**60+ checks. 12 auditor modules. 83 tests.**

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
agent-optimizer audit                              # Full 55+ check audit
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
| `audit` (55+ checks) | Full results | Full results | Full results | Full results |
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

The free audit is the full product — every check, every result, every fix instruction. You only pay when you want the tool to apply fixes automatically.

## What It Audits

| Auditor | Checks |
|---------|--------|
| **Model Config** | Primary model, fallback diversity, cross-provider redundancy, thinkingDefault, unknown keys (v2026.4.12 keys supported) |
| **Auth Profiles** | Token expiry, duplicate keys, provider coverage, placeholder credential detection (.env) |
| **Cost Estimator** | Monthly spend estimate, savings projection, expensive fallback warnings, subscription/self-hosted detection (LM Studio, Codex, Ollama) |
| **Token Efficiency** | Context window sizing, heartbeat frequency, subagent concurrency, compaction, pruning |
| **Cache Efficiency** | cacheRetention config, heartbeat vs cache TTL alignment, lightContext, compaction model cost |
| **Bootstrap Files** | Per-file size vs 20K limit, total vs 150K budget, truncation warnings, missing SOUL/IDENTITY |
| **Security Scanner** | 28 patterns: billing, injection, obfuscation, exfiltration. Per-skill scoring. Provenance detection |
| **Plugins** | Stale installs, allowlist gaps, orphaned entries, bundled plugin recognition (memory-wiki, dreaming, active-memory, etc.) |
| **Legacy Overrides** | Codex transport override, hardcoded API keys in models.json, allowPrivateNetwork validation |
| **Tool Permissions** | Allow/deny conflicts, elevated channel restrictions |
| **Provider Failover** | Chain depth, provider diversity, auth coverage, cost escalation, latency risk |
| **Channel Security** | DM/group policies, allowlist gaps, mutable ID warnings |

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

Channel Security
  ⚠ No default DM policy set

─── Summary ───
  23 pass  8 warn  1 fail  Total: 46

🦞 Found 1 critical and 8 warnings. Want to fix them automatically?
   Run: agent-optimizer optimize to preview changes (free)
   Run: agent-optimizer audit --fix to auto-apply (requires license)
```

## Development

```bash
npm install
npx tsx src/cli.ts audit              # Run without building
npm run build                          # Compile TypeScript
npm test                               # Run tests (83 passing)
```

## License

Proprietary. See [LICENSE.md](LICENSE.md).

Copyright (c) 2026 Drakon Systems Ltd.

---

🦞 Built by [Drakon Systems](https://drakonsystems.com) — from the team that runs AI fleets in production.
