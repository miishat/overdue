// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  PublicSubscription,
  SubscriptionHealth,
  toPublicSubscription,
} from "./SubscriptionHealth";
import type { StoredSubscription } from "@/lib/push/subscriptions";

afterEach(() => cleanup());

const NOW = new Date("2026-08-01T00:00:00.000Z");

function makeSub(overrides: Partial<PublicSubscription>): PublicSubscription {
  return {
    id: "sub-1",
    userAgent: "Test Browser",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastSuccessAt: null,
    lastFailureAt: null,
    failureCount: 0,
    ...overrides,
  };
}

describe("SubscriptionHealth", () => {
  it("renders an inviting empty state when there are no subscriptions", () => {
    render(<SubscriptionHealth subscriptions={[]} now={NOW} />);
    expect(screen.queryByTestId("subscription-health-list")).toBeNull();
    const empty = screen.getByTestId("subscription-health-empty");
    expect(empty.textContent).toMatch(/no devices/i);
  });

  it("labels a subscription that has never sent as never used, not healthy or stale", () => {
    render(
      <SubscriptionHealth
        subscriptions={[makeSub({ lastSuccessAt: null, failureCount: 0 })]}
        now={NOW}
      />,
    );
    const row = screen.getByTestId("subscription-health-row");
    expect(row.getAttribute("data-state")).toBe("never-used");
    expect(screen.getByTestId("subscription-health-label").textContent).toMatch(
      /never used/i,
    );
  });

  it("labels a recently-succeeded, zero-failure subscription as healthy", () => {
    render(
      <SubscriptionHealth
        subscriptions={[
          makeSub({
            lastSuccessAt: new Date("2026-07-30T00:00:00.000Z"),
            failureCount: 0,
          }),
        ]}
        now={NOW}
      />,
    );
    const row = screen.getByTestId("subscription-health-row");
    expect(row.getAttribute("data-state")).toBe("healthy");
    expect(screen.getByTestId("subscription-health-label").textContent).toMatch(
      /healthy/i,
    );
  });

  it("labels a subscription with failures as failing, showing the count and last-failure age", () => {
    render(
      <SubscriptionHealth
        subscriptions={[
          makeSub({
            lastSuccessAt: new Date("2026-07-01T00:00:00.000Z"),
            lastFailureAt: new Date("2026-07-31T00:00:00.000Z"),
            failureCount: 3,
          }),
        ]}
        now={NOW}
      />,
    );
    const row = screen.getByTestId("subscription-health-row");
    expect(row.getAttribute("data-state")).toBe("failing");
    const label = screen.getByTestId("subscription-health-label").textContent ?? "";
    expect(label).toMatch(/failing/i);
    expect(label).toContain("3");
  });

  it("labels a subscription that succeeded long ago with zero failures as stale, not healthy", () => {
    render(
      <SubscriptionHealth
        subscriptions={[
          makeSub({
            lastSuccessAt: new Date("2026-05-01T00:00:00.000Z"),
            failureCount: 0,
          }),
        ]}
        now={NOW}
      />,
    );
    const row = screen.getByTestId("subscription-health-row");
    expect(row.getAttribute("data-state")).toBe("stale");
    expect(screen.getByTestId("subscription-health-label").textContent).toMatch(
      /stale/i,
    );
  });

  it("renders a healthy and a failing subscription together, each with its own distinct label", () => {
    render(
      <SubscriptionHealth
        subscriptions={[
          makeSub({
            id: "healthy-sub",
            lastSuccessAt: new Date("2026-07-30T00:00:00.000Z"),
            failureCount: 0,
          }),
          makeSub({
            id: "failing-sub",
            lastSuccessAt: new Date("2026-07-01T00:00:00.000Z"),
            lastFailureAt: new Date("2026-07-31T00:00:00.000Z"),
            failureCount: 1,
          }),
        ]}
        now={NOW}
      />,
    );
    const rows = screen.getAllByTestId("subscription-health-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("data-state")).toBe("healthy");
    expect(rows[1].getAttribute("data-state")).toBe("failing");
  });

  it("derives the elapsed age from formatElapsed rather than a local calculation", () => {
    // formatElapsed(from, now) for a from exactly 400 days before now
    // reports in years/months buckets, not raw days. 400 days = 1 year.
    const from = new Date(NOW.getTime() - 400 * 86_400_000);
    render(
      <SubscriptionHealth
        subscriptions={[makeSub({ lastSuccessAt: from, failureCount: 0 })]}
        now={NOW}
      />,
    );
    const label = screen.getByTestId("subscription-health-label").textContent ?? "";
    expect(label).toContain("1 yr");
  });

  it("never renders or serialises the secret or identity fields from StoredSubscription", () => {
    // Deliberately construct a full StoredSubscription with secret material
    // and cast past the type system with `as unknown as`, simulating a
    // caller that bypasses toPublicSubscription entirely (for example a
    // spread). This does not prove the type system rejects the wider
    // shape, since the cast defeats that; it proves only that even when the
    // wider shape reaches this component at runtime, its secret fields are
    // never rendered or serialised into output.
    const full: StoredSubscription = {
      id: "sub-1",
      userId: "user-secret-id",
      endpoint: "https://push.example.com/very-secret-endpoint",
      p256dh: "SECRET_P256DH_KEY_VALUE",
      auth: "SECRET_AUTH_SECRET_VALUE",
      userAgent: "Test Browser",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      lastSuccessAt: new Date("2026-07-30T00:00:00.000Z"),
      lastFailureAt: null,
      failureCount: 0,
    };

    // Simulates the mutation this test exists to catch: a caller spreading
    // the full StoredSubscription (secrets included) into props instead of
    // projecting it. The `as unknown as` cast bypasses the compile-time
    // barrier deliberately, so this exercises runtime rendering, not just
    // the type system, against a props object that actually carries the
    // secret fields.
    const unsafelySpread = [full] as unknown as PublicSubscription[];

    const { container } = render(
      <SubscriptionHealth subscriptions={unsafelySpread} now={NOW} />,
    );

    const html = container.innerHTML;
    expect(html).not.toContain(full.p256dh);
    expect(html).not.toContain(full.auth);
    expect(html).not.toContain(full.userId);
    expect(html).not.toContain(full.endpoint);
  });

  it("labels a subscription that has never delivered but has failed repeatedly as failing, not never-used", () => {
    render(
      <SubscriptionHealth
        subscriptions={[
          makeSub({
            lastSuccessAt: null,
            lastFailureAt: new Date("2026-07-31T00:00:00.000Z"),
            failureCount: 9,
          }),
        ]}
        now={NOW}
      />,
    );
    const row = screen.getByTestId("subscription-health-row");
    expect(row.getAttribute("data-state")).toBe("failing");
    const label = screen.getByTestId("subscription-health-label").textContent ?? "";
    expect(label).toMatch(/failing/i);
    expect(label).toContain("9");
    expect(label).not.toMatch(/never used/i);
  });
});

describe("toPublicSubscription", () => {
  const full: StoredSubscription = {
    id: "sub-1",
    userId: "user-secret-id",
    endpoint: "https://push.example.com/very-secret-endpoint",
    p256dh: "SECRET_P256DH_KEY_VALUE",
    auth: "SECRET_AUTH_SECRET_VALUE",
    userAgent: "Test Browser",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastSuccessAt: new Date("2026-07-30T00:00:00.000Z"),
    lastFailureAt: null,
    failureCount: 0,
  };

  it("projects to exactly the six public fields, no more and no fewer", () => {
    const result = toPublicSubscription(full);
    expect(Object.keys(result).sort()).toEqual(
      [
        "id",
        "userAgent",
        "createdAt",
        "lastSuccessAt",
        "lastFailureAt",
        "failureCount",
      ].sort(),
    );
  });

  it("drops the secret and identity fields entirely", () => {
    const result = toPublicSubscription(full);
    expect(result).not.toHaveProperty("p256dh");
    expect(result).not.toHaveProperty("auth");
    expect(result).not.toHaveProperty("userId");
    expect(result).not.toHaveProperty("endpoint");
  });

  // Mutation proof for CRITICAL 1: a spread-based projection carries every
  // field of StoredSubscription, including the secrets, so it must fail the
  // exact-six-keys assertion above. This is not exercised automatically;
  // see task-15-report.md for the recorded failing output when
  // toPublicSubscription is temporarily replaced with `(sub) => ({ ...sub })`.
});
