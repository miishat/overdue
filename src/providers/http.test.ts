import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../tests/msw-server";
import { asArray, asNumber, asRecord, asString, fetchJson } from "./http";

const URL = "https://example.test/thing";

describe("fetchJson", () => {
  it("returns the parsed value on a successful JSON response", async () => {
    server.use(http.get(URL, () => HttpResponse.json({ hello: "world" })));
    await expect(fetchJson(URL)).resolves.toEqual({ hello: "world" });
  });

  it("returns null on a 500", async () => {
    server.use(http.get(URL, () => new HttpResponse(null, { status: 500 })));
    await expect(fetchJson(URL)).resolves.toBeNull();
  });

  it("returns null on a 404", async () => {
    server.use(http.get(URL, () => new HttpResponse(null, { status: 404 })));
    await expect(fetchJson(URL)).resolves.toBeNull();
  });

  it("returns null when the body is not valid JSON", async () => {
    server.use(http.get(URL, () => new HttpResponse("not json", { status: 200 })));
    await expect(fetchJson(URL)).resolves.toBeNull();
  });

  it("returns null on a network failure", async () => {
    server.use(http.get(URL, () => HttpResponse.error()));
    await expect(fetchJson(URL)).resolves.toBeNull();
  });

  it("swallows an AbortError from a cancelled request and returns null", async () => {
    server.use(
      http.get(URL, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ ok: true });
      }),
    );
    const controller = new AbortController();
    const promise = fetchJson(URL, { signal: controller.signal });
    controller.abort();
    await expect(promise).resolves.toBeNull();
  });
});

describe("asRecord", () => {
  it("returns the value for a plain object", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
  });

  it("returns null for an array", () => {
    expect(asRecord([1, 2, 3])).toBeNull();
  });

  it("returns null for null", () => {
    expect(asRecord(null)).toBeNull();
  });

  it("returns null for a primitive", () => {
    expect(asRecord("hello")).toBeNull();
  });
});

describe("asArray", () => {
  it("returns the array unchanged", () => {
    expect(asArray([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("returns an empty array for a non-array", () => {
    expect(asArray({ items: [1] })).toEqual([]);
  });

  it("returns an empty array for null/undefined", () => {
    expect(asArray(null)).toEqual([]);
    expect(asArray(undefined)).toEqual([]);
  });
});

describe("asString", () => {
  it("returns the string", () => {
    expect(asString("hi")).toBe("hi");
  });

  it("returns undefined for a non-string", () => {
    expect(asString(42)).toBeUndefined();
  });
});

describe("asNumber", () => {
  it("returns the finite number", () => {
    expect(asNumber(42)).toBe(42);
  });

  it("returns undefined for NaN", () => {
    expect(asNumber(NaN)).toBeUndefined();
  });

  it("returns undefined for Infinity", () => {
    expect(asNumber(Infinity)).toBeUndefined();
  });

  it("returns undefined for a numeric string", () => {
    expect(asNumber("42")).toBeUndefined();
  });
});
