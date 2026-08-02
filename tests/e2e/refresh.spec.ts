import { expect, test } from "@playwright/test";
import { LOCAL_USER_ID } from "@/lib/current-user";
import { drizzleSubscriptionStore } from "@/lib/push/subscriptions";
import { createDrizzleRefreshPort } from "@/lib/refresh/port";
import { runRefresh, type RefreshPort } from "@/lib/refresh/run";
import {
  changeLogCountFor,
  clearSeeded,
  HISTORY_FIXTURE,
  REFRESH_FIXTURE,
  REFRESH_FIXTURE_REGISTRY,
  seedRefreshFixture,
  seedReleaseDateHistory,
  seedSettingsFixture,
  SETTINGS_FIXTURE,
  storedReleaseDateFor,
  subscriptionsByEndpoint,
} from "./fixtures/seed-states";

// Matches playwright.config.ts's webServer env override exactly. That
// override exists only for this spec: CRON_SECRET is unset on the
// developer's own machine, and the route answers 503 (not 401) when it is
// unset, so the 401 cases below cannot be exercised at all without a known
// secret for the server process Playwright starts. See the comment on that
// override for why this does not touch the route's own logic.
const CRON_SECRET = "e2e-test-cron-secret-not-a-real-credential";

/**
 * WHY NO AUTHORIZED CALL TO THE HTTP ROUTE IS MADE ANYWHERE IN THIS SUITE.
 *
 * POST /api/refresh runs runRefresh against drizzleRefreshPort, whose
 * candidates() is every book the local user tracks. There is no test
 * database: DATABASE_URL is the developer's real Neon instance with their
 * own library in it. So a single authorized call makes live provider calls
 * for up to 25 of their real books, rewrites those books' rows, deletes and
 * re-inserts their release_sources, appends change_log rows against them,
 * stamps lastRefreshedAt, enqueues date_change and digest notifications and
 * then drains the queue as real web-push messages to every subscribed
 * device. None of that is reversible by a fixture cleanup scoped to fixture
 * ids, and an earlier version of this spec did exactly that to five real
 * books.
 *
 * The route's own contract is auth plus a JSON envelope, and every branch of
 * it is covered without side effects: the 401s below, and 503-when-unset,
 * GET 405 and the response body shape in src/app/api/refresh/route.test.ts,
 * which injects a fake port.
 *
 * The refresh BEHAVIOUR (real diff, real change_log literal, real write-back,
 * real idempotence) is proved in the second describe below by calling
 * runRefresh directly with a port built from createDrizzleRefreshPort. That
 * port is the production one: the same candidate query, the same snapshot
 * read, the same prediction, the same persistResolvedBook, the same read
 * back. Only two things are narrowed, and both are narrowed to make the run
 * safe rather than to make it pass:
 *
 *   1. candidates() is filtered down to the fixture's own book id, so no
 *      book the fixture did not create can enter the slice.
 *   2. the provider registry is the fixture adapter, so no live network call
 *      is made and CI stays inside the milestone's Global Constraint.
 */
test.describe.serial("POST /api/refresh authentication", () => {
  test("with no Authorization header returns 401", async ({ request }) => {
    const res = await request.post("/api/refresh");
    expect(res.status()).toBe(401);
  });

  test("with a wrong secret returns 401", async ({ request }) => {
    const res = await request.post("/api/refresh", {
      headers: { authorization: "Bearer not-the-real-secret" },
    });
    expect(res.status()).toBe(401);
  });

  test("with a correct secret in the wrong scheme returns 401", async ({ request }) => {
    const res = await request.post("/api/refresh", {
      headers: { authorization: CRON_SECRET },
    });
    expect(res.status()).toBe(401);
  });

  test("GET returns 405", async ({ request }) => {
    const res = await request.get("/api/refresh");
    expect(res.status()).toBe(405);
  });
});

/**
 * The production port, with candidates() narrowed to the one fixture book.
 *
 * The narrowing runs the REAL candidates() query first and filters its
 * result, rather than fabricating a candidate row. That keeps the assertion
 * honest in both directions: if the real query ever stopped returning a
 * tracked book, the filter would yield nothing and examined would be 0, so
 * the test fails rather than quietly testing a row it invented. And because
 * the slice is exactly one book long, selectSlice's ordering (never-refreshed
 * first, then oldest lastRefreshedAt, capped at 25) can no longer decide
 * whether the fixture is examined: it is examined on every run, including the
 * second one after run one has stamped lastRefreshedAt on it.
 */
function fixtureScopedPort(): RefreshPort {
  const real = createDrizzleRefreshPort(REFRESH_FIXTURE_REGISTRY);
  return {
    ...real,
    async candidates() {
      const all = await real.candidates();
      return all.filter((row) => row.bookId === REFRESH_FIXTURE.bookId);
    },
  };
}

test.describe.serial("a refresh run over the fixture book", () => {
  test.beforeAll(async () => {
    await clearSeeded();
    await seedRefreshFixture();
  });

  test.afterAll(async () => {
    await clearSeeded();
  });

  test("examines the fixture book, corrects its stored release date, and records the move as a release_date change", async () => {
    expect(await changeLogCountFor(REFRESH_FIXTURE.bookId)).toBe(0);
    expect(await storedReleaseDateFor(REFRESH_FIXTURE.bookId)).toBe(
      REFRESH_FIXTURE.seededDate,
    );

    const result = await runRefresh(fixtureScopedPort(), new Date());

    // Asserted from the result, not inferred: the book was really looked at,
    // and it was the only book looked at.
    expect(result.examined).toBe(1);
    expect(result.failures).toEqual([]);
    expect(result.changed).toBe(1);

    // The write-back really happened, in the real database.
    expect(await storedReleaseDateFor(REFRESH_FIXTURE.bookId)).toBe(
      REFRESH_FIXTURE.correctedDate,
    );

    // The literal the writer put in the `field` column, read back out of
    // Postgres. src/lib/refresh/diff.ts and src/lib/changes.ts are unit
    // tested separately, so only a run like this one proves the value that
    // survives the round trip is the one both sides expect.
    expect(await changeLogCountFor(REFRESH_FIXTURE.bookId, "release_date")).toBe(1);
  });

  test("re-examines the same book on a second run and appends no further history", async () => {
    const totalBefore = await changeLogCountFor(REFRESH_FIXTURE.bookId);
    expect(totalBefore).toBeGreaterThan(0);

    const result = await runRefresh(fixtureScopedPort(), new Date());

    // The claim that makes the row counts below mean anything. Without it,
    // "no new rows" could equally mean "the book was never examined", which
    // is what happened when this ran through the unscoped HTTP route: run one
    // stamped lastRefreshedAt, so run two sorted the fixture behind every
    // still-never-refreshed real book and out of the 25-book slice entirely.
    expect(result.examined).toBe(1);
    expect(result.failures).toEqual([]);

    // Genuinely idempotent: the stored state now matches what the same
    // source reports, so the diff is empty and nothing is appended.
    expect(result.changed).toBe(0);
    expect(result.changeRows).toBe(0);
    expect(await changeLogCountFor(REFRESH_FIXTURE.bookId)).toBe(totalBefore);
    expect(await changeLogCountFor(REFRESH_FIXTURE.bookId, "release_date")).toBe(1);
    expect(await storedReleaseDateFor(REFRESH_FIXTURE.bookId)).toBe(
      REFRESH_FIXTURE.correctedDate,
    );
  });
});

test.describe.serial("Book detail renders a stored release_date change", () => {
  test.beforeAll(async () => {
    await clearSeeded();
    await seedRefreshFixture();
    await seedReleaseDateHistory();
  });

  test.afterAll(async () => {
    await clearSeeded();
  });

  // The reader half of the field-name contract, with no provider involved.
  // seedReleaseDateHistory writes the bare string "release_date" into the
  // column; this asserts the page finds it, parses both values and renders
  // the move. If the literal the reader filters on ever stopped matching the
  // literal in the database, the section would fall back to its empty state
  // and this fails.
  test("shows the move rather than the empty state", async ({ page }) => {
    const response = await page.goto(`/books/${HISTORY_FIXTURE.bookId}`);
    expect(response?.status()).toBe(200);

    const history = page.locator("section", { hasText: "Change history" }).last();
    await expect(history).not.toContainText("No recorded date changes.");
    // formatImprecise(date, "day") renders "D MMM YYYY".
    await expect(history).toContainText("1 Mar 2026 to 15 Sep 2026");
  });
});

test.describe.serial("the push subscription upsert", () => {
  test.beforeAll(async () => {
    await clearSeeded();
    await seedSettingsFixture(new Date());
  });

  test.afterAll(async () => {
    await clearSeeded();
  });

  // The one claim the store's unit tests cannot make. They assert on
  // buildUpsertStatement's .toSQL() output, which shows the conflict target
  // this code MEANT to use but can say nothing about whether Postgres has an
  // index matching it. A mismatch between onConflictDoUpdate's target and the
  // real push_subscription_endpoint_unique index turns every re-subscribe
  // into a duplicate row (or an error), and only a real database can tell.
  test("updates the existing row for a repeated endpoint instead of inserting a second one", async () => {
    const endpoint = SETTINGS_FIXTURE.failingEndpoint;

    const seeded = await subscriptionsByEndpoint(endpoint);
    expect(seeded).toHaveLength(1);
    expect(seeded[0].failureCount).toBe(SETTINGS_FIXTURE.failingCount);
    const seededId = seeded[0].id;

    await drizzleSubscriptionStore.upsert(LOCAL_USER_ID, {
      endpoint,
      p256dh: "e2e-fixture-p256dh-resubscribed",
      auth: "e2e-fixture-auth-resubscribed",
      userAgent: "E2E Resubscribed Device",
    });

    await drizzleSubscriptionStore.upsert(LOCAL_USER_ID, {
      endpoint,
      p256dh: "e2e-fixture-p256dh-resubscribed-again",
      auth: "e2e-fixture-auth-resubscribed-again",
      userAgent: "E2E Resubscribed Device Again",
    });

    const after = await subscriptionsByEndpoint(endpoint);
    expect(after).toHaveLength(1);
    // Same row, not a replacement: the conflict path updated in place.
    expect(after[0].id).toBe(seededId);
    expect(after[0].p256dh).toBe("e2e-fixture-p256dh-resubscribed-again");
    expect(after[0].auth).toBe("e2e-fixture-auth-resubscribed-again");
    expect(after[0].userAgent).toBe("E2E Resubscribed Device Again");
    // Re-subscribing means the device is reachable again, so the failure
    // health from the seeded row must be cleared rather than carried over.
    expect(after[0].failureCount).toBe(0);
    expect(after[0].lastFailureAt).toBeNull();
  });
});
