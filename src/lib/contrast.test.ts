import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "./contrast";

const DARK = {
  ink: "#0D0E10",
  leaf: "#16181B",
  rule: "#2B2E33",
  body: "#E6E4DF",
  quiet: "#8A8D93",
  verdigris: "#5F8C7D",
  oxide: "#D99A2B",
};

const LIGHT = {
  ink: "#F2F3F1",
  leaf: "#FFFFFF",
  rule: "#DCDEDA",
  body: "#16181B",
  quiet: "#6B6F73",
  verdigris: "#3F6357",
  oxide: "#8A5A12",
};

describe("relativeLuminance", () => {
  it("returns 0 for black and 1 for white", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("accepts lowercase and a missing hash", () => {
    expect(relativeLuminance("ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("rejects a malformed hex rather than returning a wrong number", () => {
    expect(() => relativeLuminance("#12345")).toThrow();
    expect(() => relativeLuminance("nonsense")).toThrow();
  });
});

describe("contrastRatio", () => {
  it("gives 21 for black against white", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
  });

  it("is order independent", () => {
    const a = contrastRatio("#0D0E10", "#E6E4DF");
    const b = contrastRatio("#E6E4DF", "#0D0E10");
    expect(a).toBeCloseTo(b, 10);
  });

  it("gives 1 for a colour against itself", () => {
    expect(contrastRatio("#5F8C7D", "#5F8C7D")).toBeCloseTo(1, 10);
  });
});

/*
 * These are the pairs that actually appear in the UI. Each one is a real
 * rendering decision, so a palette change that breaks one fails here.
 */
describe("AA contrast, dark scheme", () => {
  it("body text on both grounds clears 4.5:1", () => {
    expect(contrastRatio(DARK.body, DARK.ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(DARK.body, DARK.leaf)).toBeGreaterThanOrEqual(4.5);
  });

  it("quiet metadata text on both grounds clears 4.5:1", () => {
    expect(contrastRatio(DARK.quiet, DARK.ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(DARK.quiet, DARK.leaf)).toBeGreaterThanOrEqual(4.5);
  });

  it("the left rule clears 3:1 against both grounds as a non-text element", () => {
    expect(contrastRatio(DARK.body, DARK.ink)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(DARK.rule, DARK.ink)).toBeGreaterThanOrEqual(1.2);
  });

  it("oxide and verdigris clear 3:1 against both grounds", () => {
    expect(contrastRatio(DARK.oxide, DARK.ink)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(DARK.oxide, DARK.leaf)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(DARK.verdigris, DARK.ink)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(DARK.verdigris, DARK.leaf)).toBeGreaterThanOrEqual(3);
  });
});

describe("AA contrast, light scheme", () => {
  it("body text on both grounds clears 4.5:1", () => {
    expect(contrastRatio(LIGHT.body, LIGHT.ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(LIGHT.body, LIGHT.leaf)).toBeGreaterThanOrEqual(4.5);
  });

  it("quiet metadata text on both grounds clears 4.5:1", () => {
    expect(contrastRatio(LIGHT.quiet, LIGHT.ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(LIGHT.quiet, LIGHT.leaf)).toBeGreaterThanOrEqual(4.5);
  });

  it("oxide and verdigris clear 3:1 against both grounds", () => {
    expect(contrastRatio(LIGHT.oxide, LIGHT.ink)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(LIGHT.oxide, LIGHT.leaf)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(LIGHT.verdigris, LIGHT.ink)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(LIGHT.verdigris, LIGHT.leaf)).toBeGreaterThanOrEqual(3);
  });
});
