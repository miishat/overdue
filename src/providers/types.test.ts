import { describe, expect, it } from "vitest";
import { normaliseIsbn13 } from "./types";

describe("normaliseIsbn13", () => {
  it("strips hyphens and spaces", () => {
    expect(normaliseIsbn13("978-0-7653-2635-5")).toBe("9780765326355");
  });

  it("returns null for a 10 digit ISBN", () => {
    expect(normaliseIsbn13("0765326353")).toBeNull();
  });

  it("returns null for junk", () => {
    expect(normaliseIsbn13("not an isbn")).toBeNull();
  });
});
