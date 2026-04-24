import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { auditDreamingCron } from "../src/auditors/dreaming-cron.js";
import type { OpenClawConfig } from "../src/types.js";

const TEST_HOME = join(process.cwd(), "__test_dreaming_home__");
const CRON_DIR = join(TEST_HOME, ".openclaw", "cron");
const CRON_FILE = join(CRON_DIR, "jobs.json");

let ORIGINAL_HOME: string | undefined;

beforeEach(() => {
  ORIGINAL_HOME = process.env.HOME;
  process.env.HOME = TEST_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true, force: true });
  mkdirSync(CRON_DIR, { recursive: true });
});

afterEach(() => {
  process.env.HOME = ORIGINAL_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true, force: true });
});

const emptyConfig: OpenClawConfig = {};

describe("auditDreamingCron", () => {
  it("returns empty when jobs.json does not exist", () => {
    // no file written
    const results = auditDreamingCron(emptyConfig);
    expect(results).toHaveLength(0);
  });

  it("returns empty when jobs.json has no dreaming jobs", () => {
    writeFileSync(
      CRON_FILE,
      JSON.stringify({
        jobs: [
          { id: "j1", label: "backup", session: "agent:main:cron:abc", module: "./backup.js" },
        ],
      })
    );
    const results = auditDreamingCron(emptyConfig);
    expect(results).toHaveLength(0);
  });

  it("warns for pre-2026.4.23 main-session dreaming job", () => {
    writeFileSync(
      CRON_FILE,
      JSON.stringify({
        jobs: [
          {
            id: "d1",
            label: "dreaming",
            session: "agent:main:main",
            module: "./dreaming/run.js",
          },
        ],
      })
    );
    const results = auditDreamingCron(emptyConfig);
    const warn = results.find((r) => r.status === "warn");
    expect(warn).toBeDefined();
    expect(warn!.check.toLowerCase()).toContain("dreaming");
    expect(warn!.fix).toContain("openclaw doctor --fix");
  });

  it("does not warn for v2026.4.23-shape dreaming job (isolated agent session)", () => {
    writeFileSync(
      CRON_FILE,
      JSON.stringify({
        jobs: [
          {
            id: "d1",
            label: "dreaming",
            session: "agent:main:dreaming:lightweight",
            module: "./dreaming/run.js",
          },
        ],
      })
    );
    const results = auditDreamingCron(emptyConfig);
    expect(results.some((r) => r.status === "warn")).toBe(false);
  });

  it("emits info result on malformed jobs.json", () => {
    writeFileSync(CRON_FILE, "not json at all");
    const results = auditDreamingCron(emptyConfig);
    expect(results.some((r) => r.status === "info")).toBe(true);
  });
});
