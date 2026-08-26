import type { AuditResult } from "../../types.js";
import { section, type HermesConfig } from "./types.js";

// Only audit channels whose key actually exists in the config — a channel that
// is not configured cannot be open. Hermes names the allowlist differently per
// channel (verified against a live 0.15+ config): telegram uses allowed_chats,
// slack/discord/mattermost use allowed_channels, matrix uses allowed_rooms.
const HERMES_CHANNELS: Array<{ name: string; allowKey: string; unit: string }> = [
  { name: "telegram", allowKey: "allowed_chats", unit: "chat" },
  { name: "slack", allowKey: "allowed_channels", unit: "channel" },
  { name: "discord", allowKey: "allowed_channels", unit: "channel" },
  { name: "mattermost", allowKey: "allowed_channels", unit: "channel" },
  { name: "matrix", allowKey: "allowed_rooms", unit: "room" },
];

// The allowlist is either a YAML list or a comma-separated string.
function allowlistCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string" && value.trim() !== "") {
    return value.split(",").filter((s) => s.trim() !== "").length;
  }
  return 0;
}

export function auditHermesChannelSecurity(config: HermesConfig): AuditResult[] {
  const results: AuditResult[] = [];

  for (const { name, allowKey, unit } of HERMES_CHANNELS) {
    const channel = section(config, name);
    if (!channel) continue;

    const count = allowlistCount(channel[allowKey]);
    // Hermes generates every channel section with defaults, so an empty
    // allowlist alone does not mean the channel is live. require_mention: true
    // is itself a gate — downgrade those to info instead of crying wolf.
    const mentionGated = channel["require_mention"] === true;

    if (count > 0) {
      results.push({
        category: "Hermes Channel Security",
        check: `${name}: ${allowKey}`,
        status: "pass",
        message: `${name} restricted to ${count} allowed ${unit}${count === 1 ? "" : "s"}`,
      });
    } else if (mentionGated) {
      results.push({
        category: "Hermes Channel Security",
        check: `${name}: ${allowKey}`,
        status: "info",
        message: `${name} has no ${allowKey} but requires an @mention — consider an allowlist if the channel is active`,
      });
    } else {
      results.push({
        category: "Hermes Channel Security",
        check: `${name}: ${allowKey}`,
        status: "warn",
        message: `${name} has no ${allowKey} — any ${name} ${unit} can reach the agent`,
        fix: `Add ${unit} ids to ${name}.${allowKey} in ~/.hermes/config.yaml`,
      });
    }
  }

  return results;
}
