# Monitor Subscription — Design

**Date:** 2026-04-16
**Status:** Approved for implementation (Phase 1 only)
**Owner:** Michael Kyriacou

## Problem

Agent Optimizer has 1000+ npm downloads and zero conversions. The product is a
one-shot CLI audit with a £29 one-time payment. Users run it once, fix what
matters, never return. The pricing model doesn't match the use case.

## Goal

Pivot to subscription by giving the tool a reason to exist in the user's
workflow after first use. Monitor their config daily, email a weekly digest,
use the digest to build a waitlist for a paid dashboard (Phase 2).

**Success criterion:** 15%+ of weekly email recipients click the "Pro waitlist"
CTA within 30 days of Phase 1 launch.

## Non-Goals (Phase 1)

- No authentication (password, session, magic link)
- No dashboard
- No subscription billing
- No real-time alerts
- No Windows support
- No multi-agent fleet view

## Architecture

### CLI

One new subcommand group: `agent-optimizer monitor`.

**`enroll <email>`** — one-time setup.
- Prompts for agent name (defaults to hostname)
- POSTs to `/api/agent-optimizer/monitor/enroll` with `{ email, agent_name, openclaw_version }`
- Server returns opaque UUID token, emails confirmation
- CLI saves `{ token, email, agent_name, enrolled_at }` to `~/.agent-optimizer/monitor.json`
- Installs cron: `0 2 * * * agent-optimizer monitor run`

**`run`** — silent daily execution via cron.
- Runs full audit (same 70+ checks)
- Extracts issue summaries only: `{ category, check, status }` — no fix text, no messages
- POSTs to `/api/agent-optimizer/monitor/ping` with `{ token, timestamp, health_score, summary }`
- Logs errors to `~/.agent-optimizer/monitor.log`

**`status`** — show enrolment + last ping.
**`disable`** — remove cron entry, delete token locally, POST to server to mark inactive.
**`test`** — dry-run the audit and show what would be sent (no POST).

### Server (drakonsystems.com)

**Database:** SQLite via better-sqlite3 on a Fly.io persistent volume.

```sql
monitors (
  id TEXT PRIMARY KEY,              -- opaque UUID
  email TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  openclaw_version TEXT,
  enrolled_at INTEGER,
  last_ping_at INTEGER,
  active INTEGER DEFAULT 1,
  weekly_email_enabled INTEGER DEFAULT 1
);

pings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id TEXT,
  timestamp INTEGER,
  health_score INTEGER,
  pass_count INTEGER,
  warn_count INTEGER,
  fail_count INTEGER,
  info_count INTEGER,
  summary_json TEXT,                -- array of {category, check, status}
  FOREIGN KEY (monitor_id) REFERENCES monitors(id)
);

weekly_sends (
  monitor_id TEXT,
  week_start INTEGER,
  sent_at INTEGER,
  PRIMARY KEY (monitor_id, week_start)
);
```

**API routes (Next.js):**

| Route | Method | Body | Behaviour |
|-------|--------|------|-----------|
| `/api/agent-optimizer/monitor/enroll` | POST | `{ email, agent_name, openclaw_version }` | Create monitor, email confirmation, return `{ token }` |
| `/api/agent-optimizer/monitor/ping` | POST | `{ token, health_score, summary }` | Record ping, rate-limit 2/day |
| `/api/agent-optimizer/monitor/unsubscribe` | GET | `?token=X&sig=Y` | One-click opt-out, set `active=0` |
| `/api/agent-optimizer/monitor/disable` | POST | `{ token }` | CLI-triggered removal |

**Weekly digest:** Fly scheduled machine runs Sunday 18:00 UTC.

1. Fetch active monitors with `last_ping_at` within last 14 days
2. Per monitor: aggregate week's pings (Mon–Sun)
3. Compute health trend (this week avg vs last week avg)
4. Compute new issues (present this week, not last)
5. Compute resolved issues (present last week, not this)
6. Cross-reference with security advisories table
7. Render HTML email via Resend
8. Record in `weekly_sends`

**Data retention:** `pings` older than 90 days auto-pruned daily. Only summary counts + issue check names survive — no full reports stored.

### Privacy

- **Nothing sensitive leaves the machine.** No config contents, no API keys, no model names beyond provider prefixes, no file paths, no fix instructions.
- **Issue summaries only** — `{ category, check, status }`. Example: `{ category: "Auth", check: "Token expiry: openai-codex:default", status: "fail" }`.
- **Agent identified by opaque UUID**, not hostname.
- **Unsubscribe one-click** via signed token in email footer.

## Weekly Email Content

HTML email, OpenClaw red branding:

- Health score + trend arrow (this week vs last)
- This week's activity stats (scans, average check count)
- Top 3 new issues (present this week, not last)
- Top 3 resolved issues
- Any new security advisories matching the user's version
- CTA: "Want real-time alerts, fleet dashboard, multi-agent view? Join Pro waitlist"
- Unsubscribe + manage links

No fix instructions in the email — preserves the paid Solo tier's value.

## Implementation Phases

**Day 1 — CLI (isolated, mockable):**
- `monitor enroll`, `run`, `status`, `disable`, `test` commands
- Cross-platform cron install via shell-out (Unix only, Windows shows "not yet supported")
- Tests with mocked POSTs

**Day 2 — Server:**
- better-sqlite3 + Fly volume
- Four API routes
- Confirmation email
- Wire CLI to real endpoints
- End-to-end test

**Day 3 — Weekly digest:**
- Aggregation script
- Fly scheduled machine
- Weekly HTML template
- Manual send test to verify format

## Exit Criteria for Phase 2

Build Phase 2 (dashboard, billing, subscription) only if after 30 days of
Phase 1:
- 200+ active monitors enrolled
- 15%+ of weekly email recipients click the Pro waitlist CTA
- Unsubscribe rate below 10% per week

Otherwise, rethink the product shape entirely.
