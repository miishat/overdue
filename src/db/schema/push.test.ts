import { describe, expect, it } from "vitest";
import { notificationQueue, pushSubscriptions } from "./push";
import { users } from "./users";

describe("pushSubscriptions", () => {
  it("has the columns a browser subscription needs", () => {
    const columns = Object.keys(pushSubscriptions);
    for (const name of ["id", "userId", "endpoint", "p256dh", "auth"]) {
      expect(columns).toContain(name);
    }
  });

  it("has the health columns subscription health depends on", () => {
    const columns = Object.keys(pushSubscriptions);
    for (const name of ["lastSuccessAt", "lastFailureAt", "failureCount"]) {
      expect(columns).toContain(name);
    }
  });
});

describe("notificationQueue", () => {
  it("carries a kind, a payload, and a sent marker", () => {
    const columns = Object.keys(notificationQueue);
    for (const name of ["id", "userId", "kind", "payload", "sentAt"]) {
      expect(columns).toContain(name);
    }
  });
});

describe("users", () => {
  it("records when the shelf was last viewed", () => {
    expect(Object.keys(users)).toContain("lastShelfViewedAt");
  });
});
