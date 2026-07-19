import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  slugifyFinding,
  isMachineFixable,
  stampFindingIds,
} from "../src/utils/finding-id.js";
import { runFullAudit } from "../src/auditors/index.js";
import type { AuditResult } from "../src/types.js";

describe("slugifyFinding", () => {
  it("produces the documented kebab slug for the reference example", () => {
    expect(slugifyFinding("Model Config", "thinkingDefault value")).toBe(
      "model-config-thinkingdefault-value",
    );
  });

  it("lowercases and turns slashes/punctuation runs into single hyphens", () => {
    expect(slugifyFinding("Auth / Token", "Expiry: 3 days!")).toBe(
      "auth-token-expiry-3-days",
    );
  });

  it("collapses repeated separators into one hyphen", () => {
    expect(slugifyFinding("A  --  B", "C")).toBe("a-b-c");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugifyFinding("  Padded  ", "  ends  ")).toBe("padded-ends");
  });

  it("is deterministic for the same inputs", () => {
    expect(slugifyFinding("Model Config", "thinkingDefault value")).toBe(
      slugifyFinding("Model Config", "thinkingDefault value"),
    );
  });

  it("never emits leading/trailing or doubled hyphens", () => {
    const slug = slugifyFinding("!!Weird / Category!!", "-- messy: check --");
    expect(slug).not.toMatch(/^-|-$/);
    expect(slug).not.toMatch(/--/);
  });

  it("gives distinct (category, check) pairs distinct slugs", () => {
    expect(slugifyFinding("Model Config", "primary")).not.toBe(
      slugifyFinding("Model Config", "fallbacks"),
    );
  });
});

// A finding audit --fix can act on: autoFixable + a concrete apply payload.
const fixable: AuditResult = {
  category: "Model Config",
  check: "fallbacks dup",
  status: "warn",
  message: "duplicate fallback",
  autoFixable: true,
  apply: [{ target: "config", op: "arrayRemove", path: "a.b", remove: ["x"] }],
};
// autoFixable but no payload the engine can execute.
const noPayload: AuditResult = {
  category: "Legacy Config",
  check: "deprecated key",
  status: "warn",
  message: "m",
  autoFixable: true,
};
// autoFixable with an EMPTY payload — still not machine-fixable.
const emptyApply: AuditResult = { ...noPayload, check: "empty", apply: [] };
// A plain informational result.
const plain: AuditResult = {
  category: "Bootstrap Files",
  check: "SOUL.md size",
  status: "pass",
  message: "ok",
};

describe("isMachineFixable", () => {
  it("is true only for autoFixable findings carrying a non-empty apply payload", () => {
    expect(isMachineFixable(fixable)).toBe(true);
  });

  it("is false when autoFixable but no payload", () => {
    expect(isMachineFixable(noPayload)).toBe(false);
  });

  it("is false when the apply payload is empty", () => {
    expect(isMachineFixable(emptyApply)).toBe(false);
  });

  it("is false when a payload exists but the finding is not autoFixable", () => {
    expect(isMachineFixable({ ...fixable, autoFixable: false })).toBe(false);
  });

  it("is false for a plain result", () => {
    expect(isMachineFixable(plain)).toBe(false);
  });
});

describe("stampFindingIds", () => {
  it("gives every result a non-empty string id", () => {
    const stamped = stampFindingIds([fixable, noPayload, plain]);
    for (const r of stamped) {
      expect(typeof r.id).toBe("string");
      expect((r.id ?? "").length).toBeGreaterThan(0);
    }
  });

  it("suffixes colliding base slugs -2, -3 while the first keeps the bare slug", () => {
    const a: AuditResult = { category: "Auth", check: "token expiry", status: "warn", message: "provider A" };
    const b: AuditResult = { category: "Auth", check: "token expiry", status: "warn", message: "provider B" };
    const c: AuditResult = { category: "Auth", check: "token expiry", status: "warn", message: "provider C" };
    const stamped = stampFindingIds([a, b, c]);
    expect(stamped.map((r) => r.id)).toEqual([
      "auth-token-expiry",
      "auth-token-expiry-2",
      "auth-token-expiry-3",
    ]);
  });

  it("keeps ids unique within a report", () => {
    const dup: AuditResult = { category: "X", check: "y", status: "info", message: "m" };
    const ids = stampFindingIds([dup, { ...dup }, { ...dup }]).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic on re-run with the same input order", () => {
    const input = [fixable, noPayload, plain, { ...fixable }];
    const first = stampFindingIds(input).map((r) => r.id);
    const second = stampFindingIds(input).map((r) => r.id);
    expect(first).toEqual(second);
  });

  it("does not mutate the input results", () => {
    const input: AuditResult[] = [{ category: "X", check: "y", status: "info", message: "m" }];
    stampFindingIds(input);
    expect(input[0].id).toBeUndefined();
    expect(input[0].machineFixable).toBeUndefined();
  });

  it("sets machineFixable to exactly isMachineFixable() for each result", () => {
    for (const r of [fixable, noPayload, emptyApply, plain]) {
      const [stamped] = stampFindingIds([r]);
      expect(stamped.machineFixable).toBe(isMachineFixable(r));
    }
  });

  it("marks the fixable one true and the plain one false", () => {
    const [sf, sp] = stampFindingIds([fixable, plain]);
    expect(sf.machineFixable).toBe(true);
    expect(sp.machineFixable).toBe(false);
  });
});

// End-to-end: prove the report that agents consume (`audit --json`) carries the
// schemaVersion + a stable id on every result. HOME is pointed at an empty dir so
// system detection finds no real ~/.claude or ~/.openclaw — runFullAudit then
// audits ONLY the temp config we hand it, keeping this hermetic.
describe("runFullAudit — report envelope", () => {
  let tmp: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ao-finding-id-"));
    prevHome = process.env.HOME;
    process.env.HOME = join(tmp, "home");
    mkdirSync(process.env.HOME, { recursive: true });
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("stamps schemaVersion:1, a unique id, and a boolean machineFixable on every result", async () => {
    const cfg = join(tmp, "openclaw.json");
    // Known issues (duplicate fallback + bogus thinkingDefault) guarantee the
    // OpenClaw auditors emit real results to stamp.
    writeFileSync(
      cfg,
      JSON.stringify({
        agents: {
          defaults: {
            model: { primary: "p", fallbacks: ["a", "p"] },
            thinkingDefault: "bogus",
          },
        },
      }),
    );

    const report = await runFullAudit({ config: cfg, silent: true });

    expect(report.schemaVersion).toBe(1);
    expect(report.results.length).toBeGreaterThan(0);
    for (const r of report.results) {
      expect(typeof r.id).toBe("string");
      expect((r.id ?? "").length).toBeGreaterThan(0);
      expect(typeof r.machineFixable).toBe("boolean");
    }
    const ids = report.results.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // ids unique within the report
  });
});
