import { describe, expect, it } from "vitest";
import { fontVariables } from "./fonts";

describe("fontVariables", () => {
  it("exposes all three families as CSS variables", () => {
    expect(fontVariables).toContain("--font-newsreader");
    expect(fontVariables).toContain("--font-instrument");
    expect(fontVariables).toContain("--font-mono");
  });
});
