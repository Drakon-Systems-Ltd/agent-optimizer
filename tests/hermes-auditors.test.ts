import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { auditHermesModelConfig } from "../src/auditors/hermes/model-config.js";
import { auditHermesApprovals } from "../src/auditors/hermes/approvals.js";
import {
  auditHermesPromptCaching,
  auditHermesCompression,
} from "../src/auditors/hermes/token-efficiency.js";
import { auditHermesMemory } from "../src/auditors/hermes/memory.js";
import { auditHermesChannelSecurity } from "../src/auditors/hermes/channel-security.js";
import { auditHermesPrivacy } from "../src/auditors/hermes/privacy.js";
import { auditHermesSkillsSafety } from "../src/auditors/hermes/skills-safety.js";
import type { HermesConfig } from "../src/auditors/hermes/types.js";

function fromYaml(y: string): HermesConfig {
  return (parseYaml(y) ?? {}) as HermesConfig;
}

describe("auditHermesModelConfig", () => {
  it("passes when model.default is set", () => {
    const results = auditHermesModelConfig(
      fromYaml(`model:\n  default: claude-sonnet-4-6\n  provider: anthropic\n`)
    );
    const r = results.find((x) => x.check === "Default model set");
    expect(r!.status).toBe("pass");
    expect(r!.message).toContain("claude-sonnet-4-6");
  });

  it("fails when model.default is missing", () => {
    const results = auditHermesModelConfig(fromYaml(`model:\n  provider: anthropic\n`));
    expect(results.some((r) => r.status === "fail" && r.check === "Default model set")).toBe(true);
  });

  it("fails when the model section is absent entirely", () => {
    const results = auditHermesModelConfig(fromYaml(`approvals:\n  mode: always\n`));
    expect(results.some((r) => r.status === "fail" && r.check === "Default model set")).toBe(true);
  });

  it("warns when fallback_providers is missing", () => {
    const results = auditHermesModelConfig(fromYaml(`model:\n  default: gpt-5\n`));
    expect(results.some((r) => r.status === "warn" && r.check === "Fallback providers")).toBe(true);
  });

  it("warns when fallback_providers is an empty list", () => {
    const results = auditHermesModelConfig(fromYaml(`fallback_providers: []\n`));
    expect(results.some((r) => r.status === "warn" && r.check === "Fallback providers")).toBe(true);
  });

  it("passes when fallback_providers is a non-empty list", () => {
    const results = auditHermesModelConfig(
      fromYaml(`fallback_providers:\n  - provider: openrouter\n`)
    );
    expect(results.some((r) => r.status === "pass" && r.check === "Fallback providers")).toBe(true);
  });

  it("does not double-report a string-valued fallback_providers (config-shape owns it)", () => {
    const results = auditHermesModelConfig(fromYaml(`fallback_providers: "[1, 2]"\n`));
    expect(results.some((r) => r.check === "Fallback providers")).toBe(false);
  });
});

describe("auditHermesApprovals", () => {
  it("emits info with the approval mode", () => {
    const results = auditHermesApprovals(fromYaml(`approvals:\n  mode: always\n`));
    const r = results.find((x) => x.check === "Approval mode");
    expect(r!.status).toBe("info");
    expect(r!.message).toContain("always");
  });

  it('warns when approval mode is "off"', () => {
    const results = auditHermesApprovals(fromYaml(`approvals:\n  mode: "off"\n`));
    expect(results.some((r) => r.status === "warn" && r.check === "Approval mode")).toBe(true);
  });

  it('warns when approval mode is "never"', () => {
    const results = auditHermesApprovals(fromYaml(`approvals:\n  mode: never\n`));
    expect(results.some((r) => r.status === "warn" && r.check === "Approval mode")).toBe(true);
  });

  it("skips the mode check when the approvals section is absent", () => {
    const results = auditHermesApprovals(fromYaml(`model:\n  default: x\n`));
    expect(results.some((r) => r.check === "Approval mode")).toBe(false);
  });

  it("emits info with the allowlist count", () => {
    const results = auditHermesApprovals(fromYaml(`command_allowlist:\n  - git\n  - npm\n`));
    const r = results.find((x) => x.check === "Command allowlist");
    expect(r!.status).toBe("info");
    expect(r!.message).toContain("2 entries");
  });

  it("warns on blanket shell entries (bash, sh, *)", () => {
    for (const entry of ["bash", "sh", '"*"']) {
      const results = auditHermesApprovals(fromYaml(`command_allowlist:\n  - git\n  - ${entry}\n`));
      const r = results.find((x) => x.check === "Blanket shell in allowlist");
      expect(r, `expected warn for entry ${entry}`).toBeDefined();
      expect(r!.status).toBe("warn");
    }
  });

  it("does not warn when the allowlist has only specific commands", () => {
    const results = auditHermesApprovals(fromYaml(`command_allowlist:\n  - git\n  - "npm test"\n`));
    expect(results.some((r) => r.check === "Blanket shell in allowlist")).toBe(false);
  });
});

describe("auditHermesPromptCaching", () => {
  it("passes when prompt_caching.cache_ttl is set", () => {
    const results = auditHermesPromptCaching(fromYaml(`prompt_caching:\n  cache_ttl: 1h\n`));
    const r = results.find((x) => x.check === "Prompt cache TTL");
    expect(r!.status).toBe("pass");
    expect(r!.message).toContain("1h");
  });

  it("warns when cache_ttl is absent", () => {
    const results = auditHermesPromptCaching(fromYaml(`prompt_caching: {}\n`));
    expect(results.some((r) => r.status === "warn" && r.check === "Prompt cache TTL")).toBe(true);
  });

  it("warns when the prompt_caching section is absent", () => {
    const results = auditHermesPromptCaching(fromYaml(`model:\n  default: x\n`));
    expect(results.some((r) => r.status === "warn" && r.check === "Prompt cache TTL")).toBe(true);
  });
});

describe("auditHermesCompression", () => {
  it("passes when compression.enabled is true", () => {
    const results = auditHermesCompression(
      fromYaml(`compression:\n  enabled: true\n  threshold: 0.8\n`)
    );
    const r = results.find((x) => x.check === "Compression enabled");
    expect(r!.status).toBe("pass");
    expect(r!.message).toContain("0.8");
  });

  it("warns when compression.enabled is false", () => {
    const results = auditHermesCompression(fromYaml(`compression:\n  enabled: false\n`));
    expect(results.some((r) => r.status === "warn" && r.check === "Compression enabled")).toBe(true);
  });

  it("warns when the compression section is absent", () => {
    const results = auditHermesCompression(fromYaml(`model:\n  default: x\n`));
    expect(results.some((r) => r.status === "warn" && r.check === "Compression enabled")).toBe(true);
  });
});

describe("auditHermesMemory", () => {
  it("emits info showing memory_enabled", () => {
    const results = auditHermesMemory(fromYaml(`memory:\n  memory_enabled: true\n`));
    const r = results.find((x) => x.check === "Memory enabled");
    expect(r!.status).toBe("info");
    expect(r!.message).toContain("true");
  });

  it("warns when write_approval is explicitly false", () => {
    const results = auditHermesMemory(
      fromYaml(`memory:\n  memory_enabled: true\n  write_approval: false\n`)
    );
    expect(results.some((r) => r.status === "warn" && r.check === "Memory write approval")).toBe(true);
  });

  it("does not warn when write_approval is true or absent", () => {
    expect(
      auditHermesMemory(fromYaml(`memory:\n  write_approval: true\n`)).some(
        (r) => r.check === "Memory write approval"
      )
    ).toBe(false);
    expect(
      auditHermesMemory(fromYaml(`memory:\n  memory_enabled: true\n`)).some(
        (r) => r.check === "Memory write approval"
      )
    ).toBe(false);
  });

  it("emits nothing when the memory section is absent", () => {
    expect(auditHermesMemory(fromYaml(`model:\n  default: x\n`))).toHaveLength(0);
  });
});

describe("auditHermesChannelSecurity", () => {
  it("warns when a configured channel has no allowed_chats", () => {
    const results = auditHermesChannelSecurity(fromYaml(`telegram:\n  bot_token: abc\n`));
    const r = results.find((x) => x.check === "telegram: allowed chats");
    expect(r!.status).toBe("warn");
    expect(r!.message).toContain("any telegram chat");
  });

  it("warns when allowed_chats is an empty list", () => {
    const results = auditHermesChannelSecurity(fromYaml(`slack:\n  allowed_chats: []\n`));
    expect(results.some((r) => r.status === "warn" && r.check === "slack: allowed chats")).toBe(true);
  });

  it("passes when allowed_chats is non-empty", () => {
    const results = auditHermesChannelSecurity(
      fromYaml(`telegram:\n  allowed_chats:\n    - 12345\n    - 67890\n`)
    );
    const r = results.find((x) => x.check === "telegram: allowed chats");
    expect(r!.status).toBe("pass");
    expect(r!.message).toContain("2 allowed chats");
  });

  it("only audits channels whose key exists", () => {
    const results = auditHermesChannelSecurity(fromYaml(`telegram:\n  allowed_chats: [1]\n`));
    expect(results).toHaveLength(1);
    expect(results[0].check).toBe("telegram: allowed chats");
  });

  it("audits each of telegram/slack/discord/mattermost/matrix when present", () => {
    const results = auditHermesChannelSecurity(
      fromYaml(
        `telegram: {}\nslack: {}\ndiscord: {}\nmattermost: {}\nmatrix: {}\n`
      )
    );
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.status === "warn")).toBe(true);
  });

  it("emits nothing when no channels are configured", () => {
    expect(auditHermesChannelSecurity(fromYaml(`model:\n  default: x\n`))).toHaveLength(0);
  });
});

describe("auditHermesPrivacy", () => {
  it("passes when redact_pii is true", () => {
    const results = auditHermesPrivacy(fromYaml(`privacy:\n  redact_pii: true\n`));
    expect(results.some((r) => r.status === "pass" && r.check === "PII redaction")).toBe(true);
  });

  it("emits info when redact_pii is false", () => {
    const results = auditHermesPrivacy(fromYaml(`privacy:\n  redact_pii: false\n`));
    expect(results.some((r) => r.status === "info" && r.check === "PII redaction")).toBe(true);
  });

  it("emits info when the privacy section is absent", () => {
    const results = auditHermesPrivacy(fromYaml(`model:\n  default: x\n`));
    expect(results.some((r) => r.status === "info" && r.check === "PII redaction")).toBe(true);
  });
});

describe("auditHermesSkillsSafety", () => {
  it("warns when inline_shell is true", () => {
    const results = auditHermesSkillsSafety(fromYaml(`skills:\n  inline_shell: true\n`));
    expect(results.some((r) => r.status === "warn" && r.check === "Inline shell")).toBe(true);
  });

  it("passes when inline_shell is explicitly false", () => {
    const results = auditHermesSkillsSafety(fromYaml(`skills:\n  inline_shell: false\n`));
    expect(results.some((r) => r.status === "pass" && r.check === "Inline shell")).toBe(true);
  });

  it("warns when guard_agent_created is false or absent", () => {
    for (const yaml of [`skills:\n  guard_agent_created: false\n`, `skills:\n  inline_shell: false\n`]) {
      const results = auditHermesSkillsSafety(fromYaml(yaml));
      expect(
        results.some((r) => r.status === "warn" && r.check === "Agent-created skill guard")
      ).toBe(true);
    }
  });

  it("passes when guard_agent_created is true", () => {
    const results = auditHermesSkillsSafety(fromYaml(`skills:\n  guard_agent_created: true\n`));
    expect(
      results.some((r) => r.status === "pass" && r.check === "Agent-created skill guard")
    ).toBe(true);
  });

  it("emits info when write_approval is false", () => {
    const results = auditHermesSkillsSafety(fromYaml(`skills:\n  write_approval: false\n`));
    expect(results.some((r) => r.status === "info" && r.check === "Skill write approval")).toBe(true);
  });

  it("emits nothing when the skills section is absent", () => {
    expect(auditHermesSkillsSafety(fromYaml(`model:\n  default: x\n`))).toHaveLength(0);
  });
});
