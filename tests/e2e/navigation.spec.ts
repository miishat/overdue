import { expect, test } from "@playwright/test";
import { clearSeeded, seedAllStates } from "./fixtures/seed-states";

test.beforeAll(async () => {
  await clearSeeded();
  await seedAllStates();
});

test.afterAll(async () => {
  await clearSeeded();
});

// Same disambiguation approach as waiting-shelf.spec.ts: the developer's own
// tracked books share this database, so a bare getByText/getByLabel query can
// collide with their real data under Playwright's strict mode. Scoping to the
// row containing a seeded, distinctive title keeps every assertion here
// honest regardless of what else is on the shelf.
function rowWithIdentity(page: import("@playwright/test").Page, text: string) {
  return page.locator('[data-slot="identity"]', { hasText: text }).locator("..");
}

test("the nav reaches Library and Search from the home page", async ({
  page,
}) => {
  const homeResponse = await page.goto("/");
  expect(homeResponse?.status()).toBe(200);

  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Library" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

  await page.goto("/");
  await nav.getByRole("link", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(
    page.getByRole("heading", { name: "Add something to track" }),
  ).toBeVisible();
});

// The empty-state link ("Nothing on the shelf yet." / "Find a book or
// series") only renders when WaitingShelf receives zero entries
// (src/components/shelf/WaitingShelf.tsx: `if (groups.length === 0)`). That
// depends on the developer's own tracked books, which this fixture must never
// delete or hide. On a database that already has real tracked rows, the
// empty state cannot appear, so this assertion cannot be made honestly here.
// Recorded as untestable rather than forced; see task-19-report.md.
// Skipped, not deleted: this is the honest outcome per the task brief when an
// assertion cannot be made without emptying the developer's live database.
// See the comment above and task-19-report.md for the full reasoning.
test.skip(
  "the shelf's empty-state link reaches /search",
  () => {},
);

test("a shelf row for a real book navigates to /books/<id>", async ({
  page,
}) => {
  await page.goto("/");
  // BOOK_HIATUS_ANCHOR_ID is a real row (RELEASED) with entry.bookId set, so
  // ShelfRow links it to /books/<bookId>, not /series/<seriesId>.
  const row = rowWithIdentity(page, "E2E Hiatus Series Book 1");
  await row.locator('[data-slot="identity"] a').click();
  await expect(page).toHaveURL(
    /\/books\/eeeeeeee-0000-4000-8000-000000000005$/,
  );
});

test("a synthetic row navigates to /series/<id>", async ({ page }) => {
  await page.goto("/");
  // The EXPECTED entry for SERIES_EXPECTED_ID is synthesised (no bookId), so
  // ShelfRow links it to /series/<seriesId>.
  const row = rowWithIdentity(page, "E2E Expected Series");
  await row.locator('[data-slot="identity"] a').click();
  await expect(page).toHaveURL(
    /\/series\/eeeeeeee-0000-4000-8000-000000000032$/,
  );
});

test("every nav destination and every reachable route returns 200, not 404", async ({
  page,
}) => {
  const routes = [
    "/",
    "/library",
    "/search",
    "/books/eeeeeeee-0000-4000-8000-000000000005",
    "/series/eeeeeeee-0000-4000-8000-000000000032",
  ];

  for (const route of routes) {
    const response = await page.goto(route);
    expect(response?.status(), `${route} should return 200`).toBe(200);
    // Next.js's default not-found page renders this heading even when it
    // (incorrectly) responds 200, so check both signals.
    await expect(
      page.getByRole("heading", { name: "404" }),
    ).toHaveCount(0);
  }
});
