# 🦞 Agent Optimizer by Drakon Systems

**Stop burning money on misconfigured OpenClaw agents.**

Audit, optimize, and secure your OpenClaw deployment. One install, one command, full report. Built from real-world fleet management of 5 AI agents across 4 servers.

**Free to install. Free to audit. Pay only when you want auto-fix.**

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
```

## What's Free vs Paid

| Command | Free | Solo (£29) | Fleet (£79) | Lifetime (£149) |
|---------|------|------------|-------------|-----------------|
| `audit` | Full results | Full results | Full results | Full results |
| `audit --fix` | Shows issues | Auto-fixes | Auto-fixes | Auto-fixes |
| `scan` | Full results | Full results | Full results | Full results |
| `optimize --dry-run` | Preview | Preview | Preview | Preview |
| `optimize` | Blocked | Applies changes | Applies changes | Applies changes |
| `fleet --hosts` | Blocked | Blocked | SSH fleet audit | SSH fleet audit |
| Updates | - | 12 months | 12 months | 12 months |
| Priority support | - | - | - | Yes |

The free audit is the full product — every check, every result, every fix instruction. You only pay when you want the tool to apply fixes automatically.

## Commands

### `agent-optimizer audit`

Full health check of your OpenClaw installation. **Free — no license needed.**

```bash
agent-optimizer audit
agent-optimizer audit --config ~/.openclaw/openclaw.json
agent-optimizer audit --json
agent-optimizer audit --fix          # Auto-fix (requires license)
agent-optimizer audit --deep         # Include live gateway probes
```

**What it checks:**

| Category | Checks |
|----------|--------|
| Model Config | Primary model, fallback diversity, cross-provider redundancy, thinkingDefault validation, unknown config keys |
| Auth Profiles | Token expiry, duplicate keys, auth coverage for primary model |
| Token Efficiency | Context window sizing, heartbeat frequency, subagent concurrency, compaction, pruning |
| Plugins | Stale installs, allowlist gaps, orphaned entries |
| Legacy Overrides | Codex transport override (api/baseUrl), hardcoded API keys in models.json |
| Tool Permissions | Allow/deny conflicts, elevated channel restrictions |

### `agent-optimizer optimize`

Token-saving optimizations with configurable profiles.

```bash
agent-optimizer optimize --dry-run                # Preview (free)
agent-optimizer optimize                          # Apply balanced (requires license)
agent-optimizer optimize --profile aggressive     # Maximum savings
agent-optimizer optimize --profile minimal        # Light touch
```

**Profiles:**

| Profile | Context | Heartbeat | Subagents | Pruning TTL |
|---------|---------|-----------|-----------|-------------|
| minimal | 500K | 4h | 6 | 1h |
| balanced | 200K | 6h | 4 | 2h |
| aggressive | 100K | 12h | 2 | 30m |

Automatically backs up your config before applying changes.

### `agent-optimizer scan`

Security scanner for installed skills, plugins, and hooks. **Free — no license needed.**

```bash
agent-optimizer scan
agent-optimizer scan --workspace ~/clawd
```

**Detects:**
- Hidden billing integrations (SkillPay, USDT, charge functions)
- Suspicious HTTP calls to non-standard endpoints
- eval() usage and shell execution patterns
- External data exfiltration patterns

We built this after finding a ClawHub skill silently charging 0.001 USDT per API call via SkillPay.me.

### `agent-optimizer fleet`

Audit multiple OpenClaw instances via SSH. **Requires Fleet or Lifetime license.**

```bash
agent-optimizer fleet --hosts jarvis,edith,tars,case
```

**Reports per host:**
- Agent name and primary model
- Heartbeat frequency and context token count
- Legacy Codex transport override detection
- Gateway status (active/inactive)

Requires SSH access configured in `~/.ssh/config`.

## Licensing

```bash
# Check license status
agent-optimizer license

# Activate after purchase
agent-optimizer activate AO-FLEE-A1B2C3D4-E5F6G7H8

# Remove license
agent-optimizer deactivate
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

Auth
  ✓ Token expiry: openai-codex:default: Valid for 116h
  ⚠ Token expiry: claude-cli:main: OAuth token expires in 45m

Token Efficiency
  ⚠ Context window size: contextTokens is 1000K — burns tokens on every turn
    Fix: Consider reducing to 200K unless you need deep history
  ✓ Heartbeat frequency: Heartbeat: 6h
  ✓ Subagent concurrency: Subagent concurrency: 4

Legacy Overrides
  ✗ Codex transport override: Legacy openai-codex transport override detected
    Fix: Remove "api" and "baseUrl" from openai-codex in models.json

─── Summary ───
  8 pass  3 warn  1 fail  Total: 12

⚠ Critical issues found — fix before deploying

🦞 Found 1 critical and 3 warnings. Want to fix them automatically?
   Run: agent-optimizer optimize to see recommended changes
   Run: agent-optimizer audit --fix to auto-fix (requires license)

   License: https://drakonsystems.com/products/agent-optimizer/buy
```

## Development

```bash
npm install
npx tsx src/cli.ts audit              # Run without building
npm run build                          # Compile TypeScript
npm test                               # Run tests (31 passing)
```

## License

Proprietary. See [LICENSE.md](LICENSE.md).

Copyright (c) 2026 Drakon Systems Ltd.

---

🦞 Built by [Drakon Systems](https://drakonsystems.com) — from the team that runs AI fleets in production.
