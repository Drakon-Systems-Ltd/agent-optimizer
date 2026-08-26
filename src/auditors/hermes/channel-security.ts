import type { AuditResult } from "../../types.js";
import { section, type HermesConfig } from "./types.js";

// Only audit channels whose key actually exists in the config — a channel that
// is not configured cannot be open.
const HERMES_CHANNELS = ["telegram", "slack", "discord", "mattermost", "matrix"];

export function auditHermesChannelSecurity(config: HermesConfig): AuditResult[] {
  const results: AuditResult[] = [];

  for (const channelName of HERMES_CHANNELS) {
    const channel = section(config, channelName);
    if (!channel) continue;

    const allowed = channel["allowed_chats"];
    const count = Array.isArray(allowed)
      ? allowed.length
      : typeof allowed === "string" && allowed.trim() !== ""
        ? 1
        : 0;

    if (count > 0) {
      results.push({
        category: "Hermes Channel Security",
        check: `${channelName}: allowed chats`,
        status: "pass",
        message: `${channelName} restricted to ${count} allowed chat${count === 1 ? "" : "s"}`,
      });
    } else {
      results.push({
        category: "Hermes Channel Security",
        check: `${channelName}: allowed chats`,
        status: "warn",
        message: `${channelName} has no allowed_chats — any ${channelName} chat can reach the agent`,
        fix: `Add chat ids to ${channelName}.allowed_chats in ~/.hermes/config.yaml`,
      });
    }
  }

  return results;
}
