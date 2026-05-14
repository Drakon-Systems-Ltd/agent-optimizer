import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenClawConfig } from "../src/types.js";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

import { existsSync, readdirSync } from "fs";
import { auditPlugins } from "../src/auditors/openclaw/plugins.js";

describe("auditPlugins — legacy path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("warns when legacy ~/.openclaw/plugins/ has contents", () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith(".openclaw/plugins")
    );
    vi.mocked(readdirSync).mockReturnValue(["old-plugin"] as never);

    const config: OpenClawConfig = { plugins: { allow: [] } };
    const results = auditPlugins(config);
    expect(results.some(r => r.check.includes("Legacy plugin directory"))).toBe(true);
  });

  it("does not warn when legacy directory is empty", () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith(".openclaw/plugins")
    );
    vi.mocked(readdirSync).mockReturnValue([] as never);

    const config: OpenClawConfig = { plugins: { allow: [] } };
    const results = auditPlugins(config);
    expect(results.some(r => r.check.includes("Legacy plugin directory"))).toBe(false);
  });

  it("does not warn when legacy directory does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const config: OpenClawConfig = { plugins: { allow: [] } };
    const results = auditPlugins(config);
    expect(results.some(r => r.check.includes("Legacy plugin directory"))).toBe(false);
  });
});
