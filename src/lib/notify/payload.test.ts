import { describe, expect, it } from "vitest";
import { isPushPayload } from "./payload";

describe("isPushPayload", () => {
  it("accepts a well-formed payload", () => {
    expect(
      isPushPayload({
        title: "New chapter",
        body: "Chapter 4 is ready",
        url: "/library/42",
        tag: "book-42",
      }),
    ).toBe(true);
  });

  it("accepts a payload with only a title", () => {
    expect(isPushPayload({ title: "New chapter" })).toBe(true);
  });

  it("rejects a payload missing title", () => {
    expect(isPushPayload({ body: "no title here" })).toBe(false);
  });

  it("rejects a payload with an empty-string title", () => {
    expect(isPushPayload({ title: "" })).toBe(false);
  });

  it("accepts a payload missing body", () => {
    expect(isPushPayload({ title: "New chapter", url: "/x" })).toBe(true);
  });

  it("treats a missing url as absent, to be defaulted by the caller", () => {
    const payload = { title: "New chapter" };
    expect(isPushPayload(payload)).toBe(true);
    if (isPushPayload(payload)) {
      expect(payload.url).toBeUndefined();
    }
  });

  it("accepts a payload missing tag", () => {
    expect(isPushPayload({ title: "New chapter" })).toBe(true);
  });

  it("rejects a wrong-typed field", () => {
    expect(isPushPayload({ title: "New chapter", body: 42 })).toBe(false);
    expect(isPushPayload({ title: "New chapter", url: 42 })).toBe(false);
    expect(isPushPayload({ title: "New chapter", tag: 42 })).toBe(false);
    expect(isPushPayload({ title: 42 })).toBe(false);
  });

  it("rejects null", () => {
    expect(isPushPayload(null)).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(isPushPayload("just a string")).toBe(false);
    expect(isPushPayload(42)).toBe(false);
    expect(isPushPayload(undefined)).toBe(false);
  });

  it("rejects an array", () => {
    expect(isPushPayload([])).toBe(false);
    expect(isPushPayload(["title", "body"])).toBe(false);
  });

  it("never throws on any input", () => {
    const inputs: unknown[] = [
      null,
      undefined,
      42,
      "string",
      [],
      {},
      { title: {} },
      Symbol("x"),
      () => {},
    ];
    for (const input of inputs) {
      expect(() => isPushPayload(input)).not.toThrow();
    }
  });
});
