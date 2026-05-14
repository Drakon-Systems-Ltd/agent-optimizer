import { execSync } from "child_process";
import type { AuditResult } from "../../types.js";

export async function runFleetAudit(opts: {
  hosts?: string;
  sshConfig?: string;
  json?: boolean;
}): Promise<void> {
  const hosts = opts.hosts?.split(",").map((h) => h.trim()) ?? [];

  if (hosts.length === 0) {
    console.log("No hosts specified. Use --hosts jarvis,edith,tars,case");
    return;
  }

  for (const host of hosts) {
    console.log(`\n--- ${host} ---`);
    try {
      const result = execSync(
        `ssh ${host} "cat ~/.openclaw/openclaw.json" 2>/dev/null`,
        { encoding: "utf-8", timeout: 15000 }
      );
      const config = JSON.parse(result);
      const primary = config.agents?.defaults?.model?.primary ?? "not set";
      const heartbeat = config.agents?.defaults?.heartbeat?.every ?? "not set";
      const contextTokens = config.agents?.defaults?.contextTokens ?? "default";
      const agentName = config.agents?.list?.[0]?.name ?? "unknown";

      console.log(`  Agent: ${agentName}`);
      console.log(`  Primary model: ${primary}`);
      console.log(`  Heartbeat: ${heartbeat}`);
      console.log(`  Context tokens: ${contextTokens}`);

      // Check for legacy overrides
      try {
        const modelsResult = execSync(
          `ssh ${host} "cat ~/.openclaw/agents/main/agent/models.json" 2>/dev/null`,
          { encoding: "utf-8", timeout: 15000 }
        );
        const models = JSON.parse(modelsResult);
        const codex = models.providers?.["openai-codex"];
        if (codex?.api || codex?.baseUrl) {
          console.log("  ⚠️  Legacy Codex transport override detected");
        }
      } catch {
        // no models.json
      }

      // Check gateway status
      try {
        const status = execSync(
          `ssh ${host} "systemctl --user is-active openclaw-gateway" 2>/dev/null`,
          { encoding: "utf-8", timeout: 10000 }
        ).trim();
        console.log(`  Gateway: ${status}`);
      } catch {
        console.log("  Gateway: unknown (systemctl failed)");
      }
    } catch (e) {
      console.log(`  ❌ Failed to connect: ${(e as Error).message.split("\n")[0]}`);
    }
  }
}
