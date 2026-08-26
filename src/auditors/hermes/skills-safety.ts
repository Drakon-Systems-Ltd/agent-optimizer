import type { AuditResult } from "../../types.js";
import { section, type HermesConfig } from "./types.js";

export function auditHermesSkillsSafety(config: HermesConfig): AuditResult[] {
  const results: AuditResult[] = [];

  const skills = section(config, "skills");
  if (!skills) return results; // no skills section — nothing to audit

  if (skills["inline_shell"] === true) {
    results.push({
      category: "Hermes Skills",
      check: "Inline shell",
      status: "warn",
      message: "skills.inline_shell is true — skills can execute inline shell commands",
      fix: "Set skills.inline_shell: false unless a skill genuinely needs it",
    });
  } else if (skills["inline_shell"] === false) {
    results.push({
      category: "Hermes Skills",
      check: "Inline shell",
      status: "pass",
      message: "Inline shell execution in skills is disabled",
    });
  }

  if (skills["guard_agent_created"] === true) {
    results.push({
      category: "Hermes Skills",
      check: "Agent-created skill guard",
      status: "pass",
      message: "Agent-created skills are guarded",
    });
  } else {
    results.push({
      category: "Hermes Skills",
      check: "Agent-created skill guard",
      status: "warn",
      message: "skills.guard_agent_created is not enabled — skills the agent writes for itself run unguarded",
      fix: "Set skills.guard_agent_created: true in ~/.hermes/config.yaml",
    });
  }

  if (skills["write_approval"] === false) {
    results.push({
      category: "Hermes Skills",
      check: "Skill write approval",
      status: "info",
      message: "skills.write_approval is false — skill file writes need no approval",
    });
  }

  return results;
}
