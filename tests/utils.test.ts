import { describe, it, expect } from "vitest";
import { parseInterval } from "../src/utils/config.js";

describe("parseInterval", () => {
  it("parses seconds", () => {
    expect(parseInterval("30s")).toBe(30);
  });

  it("parses minutes", () => {
    expect(parseInterval("5m")).toBe(300);
  });

  it("parses hours", () => {
    expect(parseInterval("6h")).toBe(21600);
  });

  it("parses days", () => {
    expect(parseInterval("1d")).toBe(86400);
  });

  it("returns 0 for invalid format", () => {
    expect(parseInterval("invalid")).toBe(0);
    expect(parseInterval("")).toBe(0);
    expect(parseInterval("10")).toBe(0);
  });
});
