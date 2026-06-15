import { describe, it, expect } from "vitest";
import { wrap, termWidth } from "../src/utils/format.js";

describe("wrap", () => {
  it("returns a single line when text fits", () => {
    expect(wrap("short text", 80)).toEqual(["short text"]);
  });

  it("breaks long text into lines no longer than the limit", () => {
    const text = "the quick brown fox jumps over the lazy dog again and again";
    const lines = wrap(text, 20);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20);
    expect(lines.join(" ")).toBe(text);
  });

  it("keeps an over-long single word intact rather than mangling it", () => {
    const longPath = "/Users/michael/.openclaw/agents/main/agent/very-long-name.json";
    expect(wrap(longPath, 20)).toEqual([longPath]);
  });

  it("returns a single empty line for empty input", () => {
    expect(wrap("", 40)).toEqual([""]);
    expect(wrap("   ", 40)).toEqual([""]);
  });
});

describe("termWidth", () => {
  it("returns a value within the clamped range", () => {
    const w = termWidth();
    expect(w).toBeGreaterThanOrEqual(48);
    expect(w).toBeLessThanOrEqual(100);
  });
});
