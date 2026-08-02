import { describe, expect, it } from "vitest";

// db/client.ts throws if DATABASE_URL is unset. neon() only builds a lazy
// query function at construction time and does not connect, so a placeholder
// here lets this pure-predicate test import tracks.ts without ever touching a
// real database.
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

describe("isValidClientReleaseDate", () => {
  it("accepts an omitted releaseDate", async () => {
    const { isValidClientReleaseDate } = await import("./tracks");
    expect(isValidClientReleaseDate(undefined)).toBe(true);
  });

  it("accepts a full day-precision date string", async () => {
    const { isValidClientReleaseDate } = await import("./tracks");
    expect(isValidClientReleaseDate("2027-01-15")).toBe(true);
  });

  it("accepts a month-precision date string", async () => {
    const { isValidClientReleaseDate } = await import("./tracks");
    expect(isValidClientReleaseDate("2027-01")).toBe(true);
  });

  it("accepts a year-only date string", async () => {
    const { isValidClientReleaseDate } = await import("./tracks");
    expect(isValidClientReleaseDate("2027")).toBe(true);
  });

  it("rejects a client-supplied null, refusing the withdrawal channel entirely", async () => {
    const { isValidClientReleaseDate } = await import("./tracks");
    expect(isValidClientReleaseDate(null)).toBe(false);
  });

  it("rejects a non-string, non-null value without throwing", async () => {
    const { isValidClientReleaseDate } = await import("./tracks");
    expect(isValidClientReleaseDate(12345)).toBe(false);
    expect(isValidClientReleaseDate({})).toBe(false);
    expect(isValidClientReleaseDate(["2027-01-01"])).toBe(false);
  });

  it("rejects a malformed date string", async () => {
    const { isValidClientReleaseDate } = await import("./tracks");
    expect(isValidClientReleaseDate("not-a-date")).toBe(false);
    expect(isValidClientReleaseDate("")).toBe(false);
  });
});
