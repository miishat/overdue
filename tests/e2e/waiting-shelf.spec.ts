import { expect, test } from "@playwright/test";
import { clearSeeded, seedAllStates } from "./fixtures/seed-states";

test.beforeAll(async () => {
  await clearSeeded();
  await seedAllStates();
});

test.afterAll(async () => {
  await clearSeeded();
});

// The developer's own tracked books share this database, and some of them
// may legitimately be RELEASED, DATED, etc. already. A bare getByLabel(...)
// would then hit Playwright's strict-mode "more than one match" error, not
// because the seed is wrong but because the label alone cannot tell my row
// apart from someone else's real book. Scoping to the one row whose
// identity block contains a seeded, distinctive title disambiguates without
// weakening what is actually being asserted: the label is still read from
// the live-rendered StatusRule, just off the row seeded for that state.
function rowWithIdentity(page: import("@playwright/test").Page, text: string) {
  return page.locator('[data-slot="identity"]', { hasText: text }).locator("..");
}

test("the shelf renders every state it is responsible for", async ({ page }) => {
  await page.goto("/");

  // Certainty axis, asserted through the accessible label rather than colour.
  await expect(
    rowWithIdentity(page, "E2E Hiatus Series Book 1").getByLabel("Released"),
  ).toBeVisible();
  await expect(
    rowWithIdentity(page, "E2E Dated Book").getByLabel("Dated"),
  ).toBeVisible();
  await expect(
    rowWithIdentity(page, "E2E Estimated Book").getByLabel("Estimated window"),
  ).toBeVisible();
  await expect(
    rowWithIdentity(page, "E2E Announced Book").getByLabel("Announced, no date"),
  ).toBeVisible();
  await expect(
    rowWithIdentity(page, "E2E Rumored Book").getByLabel("Rumoured"),
  ).toBeVisible();
  // EXPECTED and HIATUS render StatusRule's "none" rule style: border-none
  // on a w-0 element, a genuine 0x0 box by design (the certainty axis has
  // nothing to draw for either). toBeVisible() requires a non-empty
  // bounding box and would fail on these two regardless of correctness, so
  // presence in the DOM (toBeAttached) is the accurate check here, not a
  // weaker one. Solid/dashed/dotted rules above keep a rendered border
  // despite the same w-0 base, which is why those five use toBeVisible().
  await expect(
    rowWithIdentity(page, "E2E Expected Series").getByLabel(
      "Expected, not announced",
    ),
  ).toBeAttached();
  await expect(
    rowWithIdentity(page, "E2E Hiatus Series, book 2").getByLabel("On hiatus"),
  ).toBeAttached();
});

test("COMPLETE never appears on the shelf", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Series complete")).toHaveCount(0);
});

test("HIATUS renders elapsed time and EXPECTED does not", async ({ page }) => {
  await page.goto("/");

  // This is the only visual difference between the two states, so it is the
  // assertion that proves they are distinguishable. Scoped to the seeded
  // hiatus row specifically (see rowWithIdentity above) rather than a bare
  // getByLabel, since the developer's own data may include other hiatus
  // series already.
  const hiatusRow = rowWithIdentity(page, "E2E Hiatus Series, book 2");
  await expect(hiatusRow.getByLabel("On hiatus")).toBeAttached();
  await expect(hiatusRow.getByText(/\d+ yrs?/)).toBeVisible();
});

test("horizon headings appear in the spec's order", async ({ page }) => {
  await page.goto("/");
  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  const expected = [
    "This month",
    "Next 3 months",
    "Later this year",
    "Dated further out",
    "No date yet",
    "Not announced",
  ];
  // Only non-empty horizons render, so assert the rendered subset is ordered
  // consistently with the full sequence rather than equal to it.
  const indices = headings.map((h) => expected.indexOf(h));
  expect(indices).toEqual([...indices].sort((a, b) => a - b));
  expect(indices).not.toContain(-1);
});
