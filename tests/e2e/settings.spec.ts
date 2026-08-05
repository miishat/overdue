import { expect, test } from "@playwright/test";
import { clearSeeded, seedSettingsFixture, SETTINGS_FIXTURE } from "./fixtures/seed-states";

test.beforeAll(async () => {
  await clearSeeded();
  await seedSettingsFixture(new Date());
});

test.afterAll(async () => {
  await clearSeeded();
});

// Same disambiguation approach as waiting-shelf.spec.ts and
// navigation.spec.ts: the developer's own devices may already be subscribed
// in this database, so a bare getByTestId("subscription-health-row") query
// could match more than one row under Playwright's strict mode. Scoping to
// the row whose device label contains a seeded, distinctive user agent
// disambiguates without weakening what is actually asserted: health state
// and label are still read straight off the live-rendered row.
function rowForDevice(page: import("@playwright/test").Page, userAgent: string) {
  return page.locator('[data-testid="subscription-health-row"]', { hasText: userAgent });
}

test("/settings returns 200 and is reachable from the nav", async ({ page }) => {
  const direct = await page.goto("/settings");
  expect(direct?.status()).toBe(200);

  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("a subscription with a recent success renders as healthy", async ({ page }) => {
  await page.goto("/settings");

  const row = rowForDevice(page, SETTINGS_FIXTURE.healthyUserAgent);
  await expect(row).toHaveAttribute("data-state", "healthy");
  await expect(row.locator('[data-testid="subscription-health-label"]')).toContainText(
    "Healthy",
  );
});

test("a subscription with failures renders as failing, with the failure count visible", async ({
  page,
}) => {
  await page.goto("/settings");

  const row = rowForDevice(page, SETTINGS_FIXTURE.failingUserAgent);
  await expect(row).toHaveAttribute("data-state", "failing");
  const label = row.locator('[data-testid="subscription-health-label"]');
  await expect(label).toContainText("Failing");
  // SubscriptionHealth's describe() renders the raw failureCount in the
  // label text (e.g. "Failing (3 failures, ...)"), so the seeded count must
  // be the exact number shown, not merely a non-zero one.
  await expect(label).toContainText(`${SETTINGS_FIXTURE.failingCount} failures`);
});

// EnablePush's rendered state depends on whether VAPID is configured on the
// machine running the server (src/lib/notify/vapid.ts's readVapidConfig),
// which this suite cannot control or assume either way without touching
// .env.local, and the safety rules for this task forbid reading it. So this
// deliberately does not assert which of EnablePush's states renders: it
// asserts only what the task brief asks for, that the control renders
// without throwing, which holds in every one of EnablePush's states
// ("not-configured" included) and is honestly checkable regardless of this
// machine's push configuration.
test("the enable control renders without throwing when push is not configured", async ({
  page,
}) => {
  const response = await page.goto("/settings");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "404" })).toHaveCount(0);

  // push-status is EnablePush's own single rendered element across every
  // status branch (checking/unsupported/not-configured/ios-not-installed/
  // denied/subscribed/default), so its presence with non-empty text is
  // proof the component rendered something rather than throwing and
  // leaving an error boundary or a blank section in its place.
  const status = page.getByTestId("push-status");
  await expect(status).toBeVisible();
  await expect(status).not.toHaveText("");
});
