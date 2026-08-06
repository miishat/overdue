import { expect, test } from "@playwright/test";
import { clearSeeded, seedAllStates } from "../e2e/fixtures/seed-states";

test.beforeAll(async () => {
  await clearSeeded();
  await seedAllStates();
});

test.afterAll(async () => {
  await clearSeeded();
});

async function waitForController(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 30_000,
  });
}

test("the service worker registers and takes control", async ({ page }) => {
  await page.goto("/");

  // clientsClaim is true in src/sw.ts, so control arrives on the first load
  // rather than the second.
  await waitForController(page);

  const scope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.scope ?? null;
  });
  expect(scope).toContain("localhost");
});

test("the manifest and every icon it names are reachable", async ({ page, request }) => {
  await page.goto("/");

  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.status()).toBe(200);

  const manifest = (await manifestResponse.json()) as {
    id?: string;
    icons?: Array<{ src: string }>;
  };
  expect(manifest.id).toBe("/");

  // This is the assertion that would have caught the M3 bug where the
  // manifest returned 200 and every icon it referenced returned 401.
  for (const icon of manifest.icons ?? []) {
    const iconResponse = await request.get(icon.src);
    expect(iconResponse.status(), `icon ${icon.src}`).toBe(200);
  }

  // 192, not 180: the file was renamed to state its true declared size. See
  // src/app/layout.tsx.
  const appleIcon = await request.get("/icon-apple-192.png");
  expect(appleIcon.status()).toBe(200);
});

test("a tracked book's cover is served from our own origin", async ({ page }) => {
  await page.goto("/");
  await waitForController(page);

  // seedAllStates gives BOOK_DATED_ID ("E2E Dated Book") a real,
  // isSafeCoverUrl-passing cover_url (see tests/e2e/fixtures/seed-states.ts),
  // so this row is never zero and this assertion always runs. No
  // test.skip guard here: a skipped cover assertion is exactly the failure
  // mode this task exists to prevent (see task-12-brief.md and the project
  // owner's decision in the task instructions).
  const covers = page.locator('[data-slot="cover"] img');
  await expect(covers.first()).toBeVisible();
  const count = await covers.count();
  expect(count).toBeGreaterThan(0);

  const src = await covers.first().getAttribute("src");
  expect(src).toMatch(/^\/api\/covers\/[0-9a-f-]{36}$/);

  const response = await page.request.get(src as string);
  // 200 with an image if the upstream provider is reachable from CI; 502 if
  // it is not. Either proves the route is ours and is not leaking the
  // provider URL, which is what this test is for. A 404 would mean the
  // stored cover url failed isSafeCoverUrl, which is worth knowing about.
  expect([200, 502]).toContain(response.status());
  if (response.status() === 200) {
    expect(response.headers()["content-type"]).toMatch(/^image\//);
    expect(response.headers()["cache-control"]).toContain("max-age=86400");
  }
});

test("the shelf still opens with no network", async ({ page, context }) => {
  await page.goto("/");
  await waitForController(page);

  // clientsClaim only claims a client AFTER activation, so the very request
  // that installs the worker (this first goto) is never seen by the worker's
  // own fetch handler and never enters defaultCache's "others" NetworkFirst
  // cache. Confirmed empirically: without this reload, "/" is not yet in the
  // runtime cache, so going offline and reloading falls through to the
  // navigation fallback (/offline) instead of the cached shelf, which would
  // make the offline-banner assertion below fail for a reason that has
  // nothing to do with what this test is proving. Reloading once more while
  // still online lets the now-controlling worker intercept the request and
  // populate the cache for real.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Waiting" })).toBeVisible();

  await context.setOffline(true);
  try {
    await page.reload();

    // Served from defaultCache's "others" NetworkFirst, which is why this
    // works without M4 building an IndexedDB mirror.
    await expect(page.getByRole("heading", { name: "Waiting" })).toBeVisible();

    // Confirmed by hand with a throwaway debug spec: once a navigation (this
    // reload) completes while context.setOffline(true) is already in
    // effect, Chromium does not re-signal navigator.onLine as false for the
    // freshly loaded document. It reads true even though every real network
    // request genuinely fails underneath it (observed net::ERR_INTERNET_
    // DISCONNECTED on the actual fetch attempts). Re-toggling off-then-on
    // forces a genuine state transition, which is what actually flips
    // navigator.onLine and fires the "offline" event useOnlineStatus
    // listens for (src/hooks/useOnlineStatus.ts). This does not weaken what
    // is being proven: the network stays genuinely unreachable throughout,
    // and OfflineBanner still only renders in response to the browser's own
    // online/offline signal, never anything this test injects directly.
    await context.setOffline(false);
    await context.setOffline(true);

    // And the app says so, rather than presenting stale dates as current.
    await expect(page.getByTestId("offline-banner")).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

// The brief's original draft used /library for this test, but NavShell
// renders a <Link href="/library"> on every page and Next prefetches links
// in the viewport, so /library's RSC payload can already be cached by the
// time this test goes offline, which would make the assertion pass for the
// wrong reason. BOOK_HIATUS_ANCHOR_ID ("E2E Hiatus Series Book 1") is a real,
// seeded book id, but its release is six years in the past, so
// buildShelf's "this month or still pending" filter drops it from the
// Waiting Shelf entirely (src/lib/shelf.ts; see also
// tests/e2e/waiting-shelf.spec.ts's backlist test). With no row for it on
// "/", nothing ever renders a <Link href="/books/<id>"> to it, so its RSC
// payload is never prefetched and this page is genuinely never opened
// before this test navigates to it offline.
const NEVER_OPENED_ROUTE = "/books/eeeeeeee-0000-4000-8000-000000000005";

test("a page never opened before falls back to the offline page", async ({ page, context }) => {
  await page.goto("/");
  await waitForController(page);

  await context.setOffline(true);
  try {
    // A route that exists but has never been fetched on this client, so it
    // is in no runtime cache and the strategy cannot produce a response.
    await page.goto(NEVER_OPENED_ROUTE);

    await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
    await expect(page.getByRole("link", { name: /waiting shelf/i })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("a cover already seen still renders with no network", async ({ page, context }) => {
  await page.goto("/");
  await waitForController(page);

  // Same timing gap as "the shelf still opens with no network" above: the
  // very first goto predates the worker taking control, so neither the page
  // shell nor the cover image request from that load ever reaches the
  // worker's fetch handler, and book-covers' StaleWhileRevalidate cache
  // stays empty. Reload once more while online so this navigation, and the
  // cover request it makes, are both actually seen by the worker.
  await page.reload();

  // See the note on the cover-serving test above: BOOK_DATED_ID always has a
  // real cover now, so this never skips.
  const covers = page.locator('[data-slot="cover"] img');
  await expect(covers.first()).toBeVisible();
  // Let the StaleWhileRevalidate handler populate the book-covers cache.
  await page.waitForLoadState("networkidle");

  await context.setOffline(true);
  try {
    await page.reload();
    const first = page.locator('[data-slot="cover"] img').first();
    await expect(first).toBeVisible();

    // naturalWidth is 0 for an image that failed to load, which is the only
    // reliable way to tell a rendered cover from a broken one.
    const width = await first.evaluate((img) => (img as HTMLImageElement).naturalWidth);
    expect(width).toBeGreaterThan(0);
  } finally {
    await context.setOffline(false);
  }
});
