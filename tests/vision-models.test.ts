import { describe, it, expect } from "vitest";
import { auditVisionModels } from "../src/auditors/openclaw/vision-models.js";
import type { OpenClawConfig } from "../src/types.js";

describe("auditVisionModels", () => {
  it("returns empty for an empty config", () => {
    expect(auditVisionModels({})).toHaveLength(0);
  });

  it("does not warn on a valid imageModel string", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { imageModel: "openai/gpt-4.1-mini" } },
    };
    expect(auditVisionModels(config)).toHaveLength(0);
  });

  it("warns when imageModel string lacks a slash", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { imageModel: "gpt-4.1-mini" } },
    };
    const results = auditVisionModels(config);
    expect(results.some(r => r.status === "warn" && r.check === "imageModel ref")).toBe(true);
  });

  it("does not warn on a valid imageModel object primary", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { imageModel: { primary: "openai/gpt-4.1-mini" } } },
    };
    expect(auditVisionModels(config)).toHaveLength(0);
  });

  it("warns when imageModel object primary lacks a slash", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { imageModel: { primary: "badref" } } },
    };
    const results = auditVisionModels(config);
    expect(results.some(r => r.status === "warn" && r.message.includes("badref"))).toBe(true);
  });

  it("warns mentioning the bad fallback ref", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { imageModel: { primary: "openai/gpt-4.1-mini", fallbacks: ["openai/x", "badref"] } } },
    };
    const results = auditVisionModels(config);
    expect(results.some(r => r.status === "warn" && r.message.includes("badref"))).toBe(true);
    expect(results.some(r => r.message.includes("openai/x"))).toBe(false);
  });

  it("does not warn on a valid tools.media.image.models entry", () => {
    const config: OpenClawConfig = {
      tools: { media: { image: { models: [{ provider: "openai", model: "gpt-4.1" }] } } },
    };
    expect(auditVisionModels(config)).toHaveLength(0);
  });

  it("warns when an image model entry is missing provider/model", () => {
    const config: OpenClawConfig = {
      tools: { media: { image: { models: [{ capabilities: {} }] } } },
    };
    const results = auditVisionModels(config);
    expect(results.some(r => r.status === "warn" && r.check === "image model entry")).toBe(true);
  });

  it("emits an info redundancy entry when both knobs are set", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { imageModel: "openai/gpt-4.1-mini" } },
      tools: { media: { image: { models: [{ provider: "openai", model: "gpt-4.1" }] } } },
    };
    const results = auditVisionModels(config);
    expect(
      results.some(r => r.status === "info" && r.check === "imageModel + tools.media.image.models"),
    ).toBe(true);
  });

  it("does not flag imageModel equal to the primary model", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "openai/gpt-4.1-mini" },
          imageModel: "openai/gpt-4.1-mini",
        },
      },
    };
    expect(auditVisionModels(config)).toHaveLength(0);
  });
});
