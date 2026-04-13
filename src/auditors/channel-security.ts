import type { AuditResult, OpenClawConfig } from "../types.js";

const KNOWN_CHANNELS = [
  "telegram", "whatsapp", "discord", "slack", "signal",
  "msteams", "matrix", "irc", "bluebubbles", "imessage",
];

// Channels with mutable user IDs that can't be trusted for allowlists
const MUTABLE_ID_CHANNELS = ["discord", "slack", "msteams", "mattermost"];

type DmPolicy = "pairing" | "allowlist" | "open" | "disabled";
type GroupPolicy = "allowlist" | "open" | "disabled";

export function auditChannelSecurity(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];
  const channels = config.channels as Record<string, unknown> | undefined;

  if (!channels) {
    results.push({
      category: "Channel Security",
      check: "Channels configured",
      status: "info",
      message: "No channels configured — agent is CLI/terminal only",
    });
    return results;
  }

  // Check channel defaults
  const defaults = channels.defaults as Record<string, unknown> | undefined;
  const defaultDmPolicy = (defaults?.dmPolicy as DmPolicy) ?? undefined;
  const defaultGroupPolicy = (defaults?.groupPolicy as GroupPolicy) ?? undefined;

  if (!defaultDmPolicy) {
    results.push({
      category: "Channel Security",
      check: "Default DM policy",
      status: "warn",
      message: "No default DM policy set — each channel uses its own default (may be too open)",
      fix: 'Set channels.defaults.dmPolicy to "pairing" (safest) or "allowlist"',
    });
  } else if (defaultDmPolicy === "open") {
    results.push({
      category: "Channel Security",
      check: "Default DM policy",
      status: "fail",
      message: 'Default DM policy is "open" — anyone can message your agent directly',
      fix: 'Change to "pairing" or "allowlist" to restrict who can interact',
    });
  } else {
    results.push({
      category: "Channel Security",
      check: "Default DM policy",
      status: "pass",
      message: `Default DM policy: ${defaultDmPolicy}`,
    });
  }

  if (!defaultGroupPolicy) {
    results.push({
      category: "Channel Security",
      check: "Default group policy",
      status: "info",
      message: "No default group policy — falls back to allowlist (fail-closed)",
    });
  } else if (defaultGroupPolicy === "open") {
    results.push({
      category: "Channel Security",
      check: "Default group policy",
      status: "warn",
      message: 'Default group policy is "open" — agent responds in any group it\'s added to',
      fix: 'Consider "allowlist" to control which groups the agent participates in',
    });
  } else {
    results.push({
      category: "Channel Security",
      check: "Default group policy",
      status: "pass",
      message: `Default group policy: ${defaultGroupPolicy}`,
    });
  }

  // Check each configured channel
  let activeChannels = 0;
  for (const channelName of KNOWN_CHANNELS) {
    const channelConfig = channels[channelName] as Record<string, unknown> | undefined;
    if (!channelConfig) continue;

    activeChannels++;
    const dmPolicy = (channelConfig.dmPolicy as DmPolicy) ?? defaultDmPolicy ?? "pairing";
    const groupPolicy = (channelConfig.groupPolicy as GroupPolicy) ?? defaultGroupPolicy ?? "allowlist";
    const allowFrom = channelConfig.allowFrom as string[] | undefined;

    // DM policy check
    if (dmPolicy === "open") {
      results.push({
        category: "Channel Security",
        check: `${channelName}: DM policy`,
        status: "fail",
        message: `DM policy is "open" — anyone on ${channelName} can command your agent`,
        fix: `Set channels.${channelName}.dmPolicy to "pairing" or "allowlist"`,
      });
    }

    // Group policy check
    if (groupPolicy === "open") {
      results.push({
        category: "Channel Security",
        check: `${channelName}: group policy`,
        status: "warn",
        message: `Group policy is "open" — agent responds in any ${channelName} group`,
        fix: `Set channels.${channelName}.groupPolicy to "allowlist"`,
      });
    }

    // Allowlist check
    if (dmPolicy === "allowlist" && (!allowFrom || allowFrom.length === 0)) {
      results.push({
        category: "Channel Security",
        check: `${channelName}: allowlist`,
        status: "fail",
        message: `DM policy is "allowlist" but no allowFrom entries — nobody can message the agent`,
        fix: `Add user IDs to channels.${channelName}.allowFrom`,
      });
    }

    // Mutable ID warning
    if (MUTABLE_ID_CHANNELS.includes(channelName) && dmPolicy === "allowlist") {
      results.push({
        category: "Channel Security",
        check: `${channelName}: mutable IDs`,
        status: "warn",
        message: `${channelName} uses mutable user IDs — allowlist entries may break if users change display names or reconnect`,
        fix: "Use pairing-based auth instead of static allowlists where possible",
      });
    }

    // Check for token/bot credentials present
    const hasToken = channelConfig.token || channelConfig.botToken || channelConfig.apiKey;
    if (!hasToken) {
      results.push({
        category: "Channel Security",
        check: `${channelName}: credentials`,
        status: "info",
        message: `No bot token found in config — may be using env vars or SecretRef`,
      });
    }
  }

  // Check for WhatsApp-specific security
  const whatsapp = channels.whatsapp as Record<string, unknown> | undefined;
  if (whatsapp) {
    const accounts = whatsapp.accounts as Record<string, Record<string, unknown>> | undefined;
    if (accounts) {
      for (const [accountId, account] of Object.entries(accounts)) {
        const sendReadReceipts = account.sendReadReceipts as boolean | undefined;
        if (sendReadReceipts !== false) {
          results.push({
            category: "Channel Security",
            check: `WhatsApp ${accountId}: read receipts`,
            status: "info",
            message: "Read receipts enabled — contacts can see when the agent reads their messages",
          });
        }
      }
    }
  }

  // Summary
  if (activeChannels === 0) {
    results.push({
      category: "Channel Security",
      check: "Active channels",
      status: "info",
      message: "No messaging channels configured",
    });
  } else {
    results.push({
      category: "Channel Security",
      check: "Active channels",
      status: "pass",
      message: `${activeChannels} channel(s) configured`,
    });
  }

  return results;
}
