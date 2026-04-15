---
name: agent-optimizer
description: >
  Audit, optimize, and secure OpenClaw AI agent deployments. 70+ checks across
  15 auditor modules: model config, auth, cost estimation, token efficiency,
  cache, bootstrap files, security scanning, plugins, legacy overrides, tool
  permissions, provider failover, channel security, memory search, local models,
  and version-aware security advisories. Health score, config drift detection,
  fleet SSH audit. Free to install and audit.
license: SEE LICENSE IN LICENSE.md
metadata:
  author: Drakon Systems
  version: 0.8.0
  category: devtools
  tags:
    - openclaw-audit
    - openclaw-security
    - openclaw-optimize
    - config-audit
    - security-scanner
    - token-optimization
    - fleet-management
    - cost-estimation
    - malware-detection
    - devtools
    - cli
  source: https://github.com/Drakon-Systems-Ltd/agent-optimizer
  homepage: https://drakonsystems.com/products/agent-optimizer
  npm: https://www.npmjs.com/package/@drakon-systems/agent-optimizer
  verified_publisher: Drakon Systems Ltd
  publisher_github: https://github.com/Drakon-Systems-Ltd
  npm_audit: clean
  openclaw:
    requires:
      - node>=20
install:
  command: npm install -g @drakon-systems/agent-optimizer
  runtime: node
  minVersion: "20"
  note: >
    Installs the `agent-optimizer` CLI globally. Run `agent-optimizer audit` for
    a free 70+ check audit of your OpenClaw config. No account, no sign-up, no
    API key needed. License required only for auto-fix and fleet features.
---

# Agent Optimizer by Drakon Systems

**Stop burning money on misconfigured OpenClaw agents.**

One install, one command, full report. Built from real-world fleet management
of 5 AI agents across 4 servers.

## Quick Start

```bash
npm install -g @drakon-systems/agent-optimizer
agent-optimizer audit          # Free — 70+ checks, no license needed
agent-optimizer scan           # Free — malware + billing scan
agent-optimizer optimize --dry-run  # Free — preview optimizations
```

## What It Checks

- **Model Config** — primary model, fallbacks, thinkingDefault, legacy aliases, thinking compatibility
- **Auth Profiles** — token expiry, duplicates, placeholder credentials, provider coverage
- **Cost Estimator** — monthly spend, savings projection, subscription/self-hosted detection
- **Token Efficiency** — context window, heartbeat frequency, subagent concurrency
- **Cache Efficiency** — cacheRetention, heartbeat vs cache TTL, compaction model cost
- **Bootstrap Files** — per-file and total budget, truncation warnings
- **Security Scanner** — 28 patterns: billing, injection, obfuscation, exfiltration
- **Plugins** — stale installs, allowlist gaps, bundled plugin recognition
- **Legacy Overrides** — Codex transport, hardcoded keys, allowPrivateNetwork
- **Provider Failover** — chain depth, diversity, auth coverage, cost escalation
- **Channel Security** — DM/group policies, allowlist gaps, mutable IDs
- **Memory Search** — embedding provider, hybrid weights, cache, ShieldCortex detection
- **Local Models** — localModelLean, context window sizing, compaction reserve
- **Security Advisories** — 14 known CVEs from v2026.4.12–4.15 with upgrade guidance

## Pricing

| Tier | Price | Features |
|------|-------|----------|
| Free | £0 | Full audit, first 3 fix instructions, scan, preview |
| Solo | £29 | All fixes, auto-fix, optimize profiles |
| Fleet | £79 | SSH fleet audit, per-host comparison |
| Lifetime | £149 | Everything + 12mo updates + priority support |

Purchase at [drakonsystems.com/products/agent-optimizer](https://drakonsystems.com/products/agent-optimizer)
