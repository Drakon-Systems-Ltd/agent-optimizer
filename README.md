# Agent Optimizer by Drakon Systems

Audit, optimize, and secure your OpenClaw deployment. One tool, one command, zero guesswork.

Built from real-world fleet management of 5 OpenClaw agents across multiple servers.

## Install

```bash
npm install -g @drakon-systems/agent-optimizer
```

Or run locally:

```bash
git clone https://github.com/Drakon-Systems-Ltd/agent-optimizer.git
cd agent-optimizer
npm install
npm run build
```

## Commands

### `agent-optimizer audit`

Full health check of your OpenClaw installation.

```bash
agent-optimizer audit
agent-optimizer audit --config ~/.openclaw/openclaw.json
agent-optimizer audit --json
agent-optimizer audit --fix          # Apply safe auto-fixes
agent-optimizer audit --deep         # Include live gateway probes
```

**What it checks:**

| Category | Checks |
|----------|--------|
| Model Config | Primary model set, fallback diversity, cross-provider redundancy, valid thinkingDefault, unknown config keys |
| Auth Profiles | Token expiry, duplicate keys, auth coverage for primary model |
| Token Efficiency | Context window sizing, heartbeat frequency, subagent concurrency, compaction, context pruning |
| Plugins | Stale installs, allowlist gaps, orphaned entries |
| Legacy Overrides | Codex transport override (api/baseUrl), hardcoded API keys in models.json |
| Tool Permissions | Allow/deny conflicts, elevated channel restrictions |

### `agent-optimizer optimize`

Apply token-saving optimizations with configurable profiles.

```bash
agent-optimizer optimize                          # balanced (default)
agent-optimizer optimize --profile aggressive     # maximum savings
agent-optimizer optimize --profile minimal        # light touch
agent-optimizer optimize --dry-run                # preview changes
```

**Profiles:**

| Profile | Context | Heartbeat | Subagents | Pruning TTL |
|---------|---------|-----------|-----------|-------------|
| minimal | 500K | 4h | 6 | 1h |
| balanced | 200K | 6h | 4 | 2h |
| aggressive | 100K | 12h | 2 | 30m |

Automatically backs up your config before applying changes.

### `agent-optimizer scan`

Security scan for installed skills, plugins, and hooks.

```bash
agent-optimizer scan
agent-optimizer scan --workspace ~/clawd
```

**Detects:**
- Billing/payment integrations (SkillPay, USDT, charge functions)
- Suspicious HTTP calls to non-standard endpoints
- eval() usage and shell execution patterns
- External data exfiltration patterns

### `agent-optimizer fleet`

Audit multiple OpenClaw instances via SSH in one command.

```bash
agent-optimizer fleet --hosts jarvis,edith,tars,case
```

**Reports per host:**
- Agent name and primary model
- Heartbeat frequency and context token count
- Legacy Codex transport override detection
- Gateway status (active/inactive)

Requires SSH access configured in `~/.ssh/config`.

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
  ⚠ Context window size: contextTokens is 1000K — very large, burns tokens on every turn
    Fix: Consider reducing to 200K unless you need deep history
  ✓ Heartbeat frequency: Heartbeat: 6h
  ✓ Subagent concurrency: Subagent concurrency: 4

Legacy Overrides
  ✗ Codex transport override: Legacy openai-codex transport override detected
    Fix: Remove "api" and "baseUrl" from openai-codex in models.json

─── Summary ───
  8 pass  3 warn  1 fail  Total: 12

⚠ Critical issues found — fix before deploying

🔍 Drakon Systems Agent Optimizer v0.1.0
```

## Development

```bash
npm install
npx tsx src/cli.ts audit              # Run without building
npm run build                          # Compile TypeScript
npm test                               # Run tests
```

## License

Proprietary. See [LICENSE.md](LICENSE.md).

Copyright (c) 2026 Drakon Systems Ltd.

---

Built by [Drakon Systems](https://drakonsystems.com) — from the team that runs AI fleets in production.
