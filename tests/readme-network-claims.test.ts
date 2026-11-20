import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(root, "README.md"), "utf8");

// Read Commander registrations without importing the CLI or running monitoring.
function monitorSubcommands(): string[] {
  const file = "src/cli.ts";
  const source = ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest);
  const commands: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "monitor" &&
      node.expression.name.text === "command"
    ) {
      const name = node.arguments[0];
      if (!name || !ts.isStringLiteral(name)) {
        throw new Error(`${file}: monitor command is not a string literal`);
      }
      commands.push(name.text.split(/\s+/)[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return commands;
}

describe("network claims in README", () => {
  it("does not claim activation is the only network use", () => {
    expect(readme).not.toContain("The only network call is the one-time activation");
    expect(readme.toLowerCase()).not.toContain("no phone-home");
    expect(readme).toContain("verified offline");
  });

  it("documents opt-in monitoring and each endpoint's purpose", () => {
    expect(readme).toMatch(/monitoring is opt-in/i);
    expect(readme).toContain("free beta");
    expect(readme).toMatch(/\/monitor\/enroll`[^\n]*enrolment/i);
    expect(readme).toMatch(/\/monitor\/ping`[^\n]*audit/i);
    expect(readme).toMatch(/\/monitor\/disable`[^\n]*disable/i);
    expect(readme).toContain("No background monitoring runs unless");
  });

  it("documents every registered monitor subcommand", () => {
    const commands = monitorSubcommands();
    expect(commands.length, "monitor registrations must not be empty").toBeGreaterThan(0);
    const documented = [...readme.matchAll(/^agent-optimizer monitor ([\w-]+)\b/gm)].map((m) => m[1]);
    expect(documented.sort()).toEqual(commands.sort());
  });

  it("describes the posted fields and other command-triggered network uses", () => {
    for (const field of [
      "email", "agentName", "openclawVersion", "token", "timestamp", "healthScore",
      "summary", "pass", "warn", "fail", "info", "total", "issues", "category", "check", "status",
    ]) {
      expect(readme, `monitor payload field ${field}`).toContain(`\`${field}\``);
    }
    expect(readme).toMatch(/`activate <key>`[^\n]*POST/);
    expect(readme).toMatch(/`update`[^\n]*npm[^\n]*install/i);
    expect(readme).toMatch(/`buy`[^\n]*browser/i);
    expect(readme).toMatch(/`fleet --hosts[^`]*`[^\n]*SSH/);
    expect(readme).toContain("best-effort");
  });
});
