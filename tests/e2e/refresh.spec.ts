import { expect, test } from "@playwright/test";
import {
  changeLogCountFor,
  clearSeeded,
  REFRESH_FIXTURE,
  seedRefreshFixture,
} from "./fixtures/seed-states";

// Matches playwright.config.ts's webServer env override exactly. That
// override exists only for this spec: CRON_SECRET is unset on the
// developer's own machine, and the route answers 503 (not 401) when it is
// unset, so the 401 and 200 cases below cannot be exercised at all without a
// known secret for the server process Playwright starts. See the comment on
// that override for why this does not touch the route's own logic.
const CRON_SECRET = "e2e-test-cron-secret-not-a-real-credential";

test.describe.serial("POST /api/refresh", () => {
  test.beforeAll(async () => {
    await clearSeeded();
    await seedRefreshFixture();
  });

  test.afterAll(async () => {
    await clearSeeded();
  });

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

  // The real, expensive path: an authorized call actually runs runRefresh
  // against the live database, which examines every book the developer
  // tracks, not just the seeded fixture. A slow provider or a large real
  // library can make this take a while, so the timeout here is generous
  // rather than the Playwright default.
  test("with the correct secret returns 200, corrects the seeded book's release date via a real provider, and a second run writes nothing new for it", async ({
    request,
  }) => {
    test.setTimeout(120_000);

    const before = await changeLogCountFor(REFRESH_FIXTURE.bookId, "release_date");
    expect(before).toBe(0);

    const first = await request.post("/api/refresh", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(first.status()).toBe(200);

    const body = await first.json();
    expect(typeof body.examined).toBe("number");
    expect(typeof body.changed).toBe("number");
    expect(typeof body.changeRows).toBe("number");
    expect(typeof body.failures).toBe("number");
    expect(typeof body.notificationsClaimed).toBe("number");
    expect(typeof body.notificationsSent).toBe("number");
    expect(typeof body.notificationsFailed).toBe("number");

    // The highest-value assertion in the milestone: src/lib/refresh/diff.ts
    // (the writer) and src/lib/changes.ts (the reader) are tested
    // separately, so nothing but an end-to-end run can prove they agree on
    // the literal field name "release_date". The seeded book's stored date
    // (1900-01-01) is deliberately wrong; a real refresh re-fetches Wikidata's
    // entity for "Pride and Prejudice" (see seed-states.ts's REFRESH_FIXTURE
    // comment) and corrects it, which must write exactly one change_log row
    // whose field is exactly "release_date".
    const afterFirstRun = await changeLogCountFor(REFRESH_FIXTURE.bookId, "release_date");
    expect(afterFirstRun).toBe(1);

    const totalRowsAfterFirstRun = await changeLogCountFor(REFRESH_FIXTURE.bookId);

    // Idempotence, made concrete rather than asserted against fake data: the
    // book's stored state now already matches what the same provider reports,
    // so a second run must diff to nothing and append no further history for
    // this book.
    const second = await request.post("/api/refresh", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(second.status()).toBe(200);

    const totalRowsAfterSecondRun = await changeLogCountFor(REFRESH_FIXTURE.bookId);
    expect(totalRowsAfterSecondRun).toBe(totalRowsAfterFirstRun);

    const releaseDateRowsAfterSecondRun = await changeLogCountFor(
      REFRESH_FIXTURE.bookId,
      "release_date",
    );
    expect(releaseDateRowsAfterSecondRun).toBe(1);
  });
});
