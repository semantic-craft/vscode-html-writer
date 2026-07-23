import { describe, expect, it } from "vitest";
import { rangeTextMatches, replaceRange } from "./selection";

describe("selection helpers", () => {
  it("replaces only the selected source range", () => {
    const source = "甲段。\n\n乙段。\n\n丙段。";
    const start = source.indexOf("乙段");
    const end = start + "乙段。".length;
    expect(replaceRange(source, { start, end }, "乙段改写。")).toBe("甲段。\n\n乙段改写。\n\n丙段。");
  });

  it("detects stale source ranges before applying candidates", () => {
    const source = "甲段。\n\n乙段。\n\n丙段。";
    const start = source.indexOf("乙段");
    const range = { start, end: start + "乙段。".length };
    expect(rangeTextMatches(source, range, "乙段。")).toBe(true);
    expect(rangeTextMatches(source.replace("乙段", "乙段已经手改"), range, "乙段。")).toBe(false);
  });
});
