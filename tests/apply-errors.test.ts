import { describe, it, expect } from "vitest";
import { formatApplyError, formatApplySuccess } from "../src/utils/apply-errors.js";
import {
  ApplyLockedError,
  ApplyPreconditionError,
  ApplyRolledBackError,
  RollbackFailedError,
} from "../src/utils/transactional.js";

// The shared formatter that BOTH apply paths (optimize apply + audit --fix, and
// next optimize --apply-plan) route their transactionalApply failures through,
// so the four typed errors read and exit identically everywhere.
describe("formatApplyError", () => {
  it("ApplyRolledBackError → exit 1, 'rolled back', reasons, unchanged, backupId", () => {
    const err = new ApplyRolledBackError("x", { reasons: ["r-one", "r-two"], backupId: "B1" });
    const { text, exitCode } = formatApplyError(err);
    expect(exitCode).toBe(1);
    expect(text).toContain("automatically rolled back");
    expect(text).toContain("r-one");
    expect(text).toContain("r-two");
    expect(text).toContain("Your config is unchanged.");
    expect(text).toContain("B1");
  });

  it("RollbackFailedError with restored>0 → exit 2, CRITICAL/INCONSISTENT + retry --to", () => {
    const err = new RollbackFailedError("x", {
      reasons: ["boom"],
      backupId: "B2",
      restored: ["/a"],
      failed: "/b",
    });
    const { text, exitCode } = formatApplyError(err);
    expect(exitCode).toBe(2);
    expect(text).toContain("CRITICAL");
    expect(text).toContain("INCONSISTENT");
    expect(text).toContain("agent-optimizer rollback --to B2");
  });

  it("RollbackFailedError with restored=[] → exit 2, says config is STILL CHANGED (not rolled back)", () => {
    const err = new RollbackFailedError("x", {
      reasons: ["boom"],
      backupId: "B3",
      restored: [],
      failed: "",
    });
    const { text, exitCode } = formatApplyError(err);
    expect(exitCode).toBe(2);
    // The correctness fix: nothing was reverted, so the config is still changed —
    // the message must NOT imply the rollback recovered anything.
    expect(text).toContain("nothing was reverted");
    expect(text).toContain("still in the changed");
    expect(text).not.toContain("was rolled back");
    expect(text).not.toContain("INCONSISTENT");
    expect(text).toContain("agent-optimizer rollback --to B3");
  });

  it("RollbackFailedError restored=[] vs restored=[...] produce distinct, accurate headers", () => {
    const none = formatApplyError(
      new RollbackFailedError("x", { reasons: [], backupId: "B", restored: [], failed: "" })
    ).text;
    const partial = formatApplyError(
      new RollbackFailedError("x", { reasons: [], backupId: "B", restored: ["/a"], failed: "/b" })
    ).text;
    // restored=[]: still-changed wording, never INCONSISTENT.
    expect(none).toContain("nothing was reverted");
    expect(none).not.toContain("INCONSISTENT");
    // restored=[...]: INCONSISTENT wording, never the still-changed phrasing.
    expect(partial).toContain("INCONSISTENT");
    expect(partial).not.toContain("nothing was reverted");
  });

  it("ApplyLockedError → exit 1, 'Another apply is already in progress'", () => {
    const { text, exitCode } = formatApplyError(new ApplyLockedError("held"));
    expect(exitCode).toBe(1);
    expect(text).toContain("Another apply is already in progress");
  });

  it("ApplyPreconditionError → exit 1, 'Cannot apply' + underlying message", () => {
    const { text, exitCode } = formatApplyError(new ApplyPreconditionError("baseline unusable"));
    expect(exitCode).toBe(1);
    expect(text).toContain("Cannot apply");
    expect(text).toContain("baseline unusable");
  });

  it("unknown error → exit 1, surfaced not swallowed", () => {
    const { text, exitCode } = formatApplyError(new Error("kaboom"));
    expect(exitCode).toBe(1);
    expect(text).toContain("kaboom");
  });
});

describe("formatApplySuccess", () => {
  it("surfaces the backup id, restart hint, and an always-correct --to restore pointer", () => {
    const text = formatApplySuccess("B9");
    expect(text).toContain("Backup: B9");
    expect(text).toContain("systemctl --user restart openclaw-gateway");
    // Always-correct: points at `rollback --to <id>`, not a bare `rollback` that
    // would resolve the default config path and miss a non-default -c.
    expect(text).toContain("agent-optimizer rollback --to B9");
  });
});
