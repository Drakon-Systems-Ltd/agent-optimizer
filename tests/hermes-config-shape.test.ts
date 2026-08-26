import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { auditHermesConfigShape } from "../src/auditors/hermes/config-shape.js";
import type { HermesConfig } from "../src/auditors/hermes/types.js";

// The headline Hermes defect: `hermes config set` on a list-valued key stores
// the whole value as ONE QUOTED STRING and `hermes config check` still reports
// healthy. All fixtures are parsed from real YAML so the test exercises exactly
// what the runner sees.
function fromYaml(y: string): HermesConfig {
  return parseYaml(y) as HermesConfig;
}

describe("auditHermesConfigShape — string-not-list defect", () => {
  it("FAILS when fallback_providers is a quoted serialized list", () => {
    const config = fromYaml(
      `fallback_providers: "[{'provider': 'openrouter', 'model': 'claude-sonnet-4-6'}]"\n`
    );
    expect(typeof config.fallback_providers).toBe("string"); // YAML really parses it as a string
    const results = auditHermesConfigShape(config);
    const fail = results.find(
      (r) => r.status === "fail" && r.check === "fallback_providers stored as list"
    );
    expect(fail).toBeDefined();
    expect(fail!.message).toContain("quoted string");
    expect(fail!.message).toContain("hermes config set");
    expect(fail!.fix).toContain("hermes config edit");
  });

  it("FAILS when command_allowlist is a quoted serialized list", () => {
    const config = fromYaml(`command_allowlist: '["git", "npm", "ls"]'\n`);
    const results = auditHermesConfigShape(config);
    const fail = results.find(
      (r) => r.status === "fail" && r.check === "command_allowlist stored as list"
    );
    expect(fail).toBeDefined();
    expect(fail!.message).toContain("quoted string");
  });

  it("FAILS on a comma-containing string even without brackets", () => {
    const config = fromYaml(`command_allowlist: "git, npm, ls"\n`);
    const results = auditHermesConfigShape(config);
    expect(
      results.some((r) => r.status === "fail" && r.check === "command_allowlist stored as list")
    ).toBe(true);
  });

  it("does NOT fire on a real YAML list (fallback_providers)", () => {
    const config = fromYaml(
      [
        "fallback_providers:",
        "  - provider: openrouter",
        "    model: claude-sonnet-4-6",
        "  - provider: deepseek",
        "",
      ].join("\n")
    );
    const results = auditHermesConfigShape(config);
    expect(results.some((r) => r.status === "fail")).toBe(false);
    const pass = results.find((r) => r.check === "fallback_providers stored as list");
    expect(pass).toBeDefined();
    expect(pass!.status).toBe("pass");
    expect(pass!.message).toContain("2 entries");
  });

  it("does NOT fire on a real YAML list (command_allowlist)", () => {
    const config = fromYaml(`command_allowlist:\n  - git\n  - npm\n`);
    const results = auditHermesConfigShape(config);
    expect(results.some((r) => r.status === "fail")).toBe(false);
    expect(
      results.some((r) => r.status === "pass" && r.check === "command_allowlist stored as list")
    ).toBe(true);
  });

  it("warns (not fails) on a bare scalar string that does not look serialized", () => {
    const config = fromYaml(`command_allowlist: git\n`);
    const results = auditHermesConfigShape(config);
    const r = results.find((x) => x.check === "command_allowlist stored as list");
    expect(r).toBeDefined();
    expect(r!.status).toBe("warn");
  });

  it("emits nothing when both keys are absent", () => {
    expect(auditHermesConfigShape(fromYaml(`model:\n  default: gpt-5\n`))).toHaveLength(0);
  });

  it("emits nothing for null values", () => {
    expect(auditHermesConfigShape(fromYaml(`fallback_providers:\n`))).toHaveLength(0);
  });

  it("does not crash on an unexpected mapping value", () => {
    const config = fromYaml(`command_allowlist:\n  git: true\n`);
    expect(auditHermesConfigShape(config)).toHaveLength(0);
  });
});
