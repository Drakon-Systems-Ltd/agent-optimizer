import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = readFileSync(join(root, "skills/agent-optimizer/SKILL.md"), "utf8");
const frontmatter = parse(skill.split("---")[1]);
const network = frontmatter.metadata.openclaw.network.join("\n");
const disclosure = skill.split("## Data & Network Disclosure")[1].split("## Quick Start")[0];
const normalizedDisclosure = disclosure.replace(/\s+/g, " ");

// Read documentation only: never import the CLI or invoke network commands.
describe("network claims in SKILL.md", () => {
  it("describes updates as registry queries and conditional global installs", () => {
    for (const text of [frontmatter.description, network, normalizedDisclosure]) {
      expect(text).toMatch(/configured npm registry/i);
      expect(text).toMatch(/global npm install/i);
    }
    expect(normalizedDisclosure).toMatch(/version differs from the installed one/i);
    expect(skill).not.toMatch(/update check/i);
    expect(network).not.toContain("registry.npmjs.org");
  });

  it("discloses monitoring enrollment, manual or cron pings, and best-effort disable", () => {
    for (const command of ["monitor enroll", "monitor run", "monitor disable"]) {
      expect(network).toContain(command);
      expect(disclosure).toContain(command);
    }
    for (const endpoint of ["enroll", "ping", "disable"]) {
      expect(disclosure).toContain(`/api/agent-optimizer/monitor/${endpoint}`);
    }
    expect(normalizedDisclosure).toMatch(/manually or by[^.]*cron/i);
    expect(normalizedDisclosure).toMatch(/attempts to notify.*?POST.*?enrollment token/i);
    expect(normalizedDisclosure).toMatch(/best-effort[^.]*local cleanup[^.]*request fails/i);
    expect(normalizedDisclosure).toContain("pass/warn/fail/info/total");
    expect(normalizedDisclosure).toContain("AGENT_OPTIMIZER_API_BASE");
  });

  it("discloses browser purchases and fleet SSH alongside the POSTs", () => {
    for (const text of [frontmatter.description, network, normalizedDisclosure]) {
      expect(text).toMatch(/buy[^.]*browser/i);
      expect(text).toMatch(/fleet[^.]*SSH/i);
    }
    expect(disclosure).toContain("drakonsystems.com/products/agent-optimizer/buy");
    expect(normalizedDisclosure).toMatch(/browser handles the network request/i);
    expect(normalizedDisclosure).toMatch(/model overrides and check gateway service status/i);
  });

  it("does not imply activation can only contact the server once", () => {
    for (const text of [frontmatter.description, network, normalizedDisclosure]) {
      expect(text).toMatch(/reactivation/i);
    }
    expect(normalizedDisclosure).toMatch(/per invocation/i);
    expect(normalizedDisclosure).toContain("optional purchase email");
    expect(skill).not.toMatch(/one-time (?:license activation|HTTPS call|POST)/i);
  });

  it("scopes offline guarantees to local commands, not every command except monitoring", () => {
    expect(frontmatter.description).toMatch(/audit, scan, and optimize make no network calls/i);
    expect(frontmatter.install.note).toMatch(/audit, scan, and optimize make no network calls/i);
    expect(skill).not.toMatch(/(?:No data leaves the machine|Nothing is transmitted off-machine) unless/i);
    expect(skill).not.toContain("the only off-machine sends are");
    expect(disclosure).toContain("Audit, scan, and optimize make no network calls at all.");
  });

  it("keeps sensitive audit data out of server payloads without denying fleet SSH reads", () => {
    expect(normalizedDisclosure).toMatch(/Never sent to licensing or monitoring servers/);
    for (const item of ["API keys", "OAuth tokens", "SSH keys", "config file contents", "audit finding text"]) {
      expect(disclosure).toContain(item);
    }
    expect(normalizedDisclosure).toMatch(/license key and monitoring enrollment token[^.]*sent/i);
    expect(normalizedDisclosure).toMatch(/Fleet SSH reads remote config files over SSH/i);
    expect(normalizedDisclosure).toContain("{category, check-name, status}");
    expect(normalizedDisclosure).toContain("dry-run, no POST");
  });
});
