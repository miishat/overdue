import { describe, expect, it } from "vitest";
import { LOCAL_USER_ID, getCurrentUserId } from "./current-user";

describe("LOCAL_USER_ID", () => {
  it("is a syntactically valid UUID", () => {
    expect(LOCAL_USER_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("is stable, because seeded rows reference it", () => {
    expect(LOCAL_USER_ID).toBe("00000000-0000-4000-8000-000000000001");
  });
});

describe("getCurrentUserId", () => {
  it("resolves to the local user", async () => {
    await expect(getCurrentUserId()).resolves.toBe(LOCAL_USER_ID);
  });
});
