import type { AuditResult, OpenClawConfig, MediaModelRef } from "../../types.js";

const CATEGORY = "Vision Models";

function isValidRef(ref: string): boolean {
  return ref.includes("/");
}

export function auditVisionModels(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];

  const imageModel = config.agents?.defaults?.imageModel;
  const imageModels = config.tools?.media?.image?.models;
  const hasImageModel = imageModel !== undefined && imageModel !== null;
  const hasImageModels = Array.isArray(imageModels) && imageModels.length > 0;

  // Nothing configured — stay silent.
  if (!hasImageModel && !hasImageModels) return results;

  // Validate agents.defaults.imageModel.
  if (typeof imageModel === "string") {
    if (!isValidRef(imageModel)) {
      results.push({
        category: CATEGORY,
        check: "imageModel ref",
        status: "warn",
        message: `imageModel "${imageModel}" lacks provider/model form — OpenClaw splits on the first "/" and will silently ignore this ref.`,
        fix: 'Use "provider/model" form, e.g. "openai/gpt-4.1-mini"',
      });
    }
  } else if (imageModel && typeof imageModel === "object") {
    if (typeof imageModel.primary === "string" && !isValidRef(imageModel.primary)) {
      results.push({
        category: CATEGORY,
        check: "imageModel ref",
        status: "warn",
        message: `imageModel.primary "${imageModel.primary}" lacks provider/model form — OpenClaw splits on the first "/" and will silently ignore this ref.`,
        fix: 'Use "provider/model" form, e.g. "openai/gpt-4.1-mini"',
      });
    }
    if (Array.isArray(imageModel.fallbacks)) {
      for (const fallback of imageModel.fallbacks) {
        if (typeof fallback === "string" && !isValidRef(fallback)) {
          results.push({
            category: CATEGORY,
            check: "imageModel ref",
            status: "warn",
            message: `imageModel fallback "${fallback}" lacks provider/model form — OpenClaw splits on the first "/" and will silently ignore this ref.`,
            fix: 'Use "provider/model" form, e.g. "openai/gpt-4.1-mini"',
          });
        }
      }
    }
  }

  // Validate tools.media.image.models[] entries.
  if (hasImageModels) {
    imageModels.forEach((entry: MediaModelRef, index: number) => {
      const hasProviderModel =
        typeof entry?.provider === "string" && entry.provider.length > 0 &&
        typeof entry?.model === "string" && entry.model.length > 0;
      const hasSlashModel = typeof entry?.model === "string" && entry.model.includes("/");
      if (!hasProviderModel && !hasSlashModel) {
        results.push({
          category: CATEGORY,
          check: "image model entry",
          status: "warn",
          message: `tools.media.image.models[${index}] is missing provider/model — supply both a non-empty provider and model, or a model in "provider/model" form.`,
          fix: 'Set provider + model (e.g. provider:"openai", model:"gpt-4.1-mini") or a model "provider/model" ref',
        });
      }
    });
  }

  // Redundancy info: both knobs configure image understanding.
  if (hasImageModel && hasImageModels) {
    results.push({
      category: CATEGORY,
      check: "imageModel + tools.media.image.models",
      status: "info",
      message:
        "Both agents.defaults.imageModel and tools.media.image.models configure image understanding — verify the intended precedence (per-kind tools.media.image.models is consulted alongside imageModel).",
    });
  }

  return results;
}
