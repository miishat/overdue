import { expect, test } from "@playwright/test";

test("the home page offers a search box", async ({ page }) => {
  await page.goto("/search");
  await expect(
    page.getByRole("heading", { name: "Add something to track" }),
  ).toBeVisible();
  await expect(page.getByLabel("Search for a book or author")).toBeVisible();
});

test("typing a single character does not trigger a search", async ({
  page,
}) => {
  await page.goto("/search");
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/search")) requests.push(r.url());
  });
  await page.getByLabel("Search for a book or author").fill("a");
  await page.waitForTimeout(600);
  expect(requests).toEqual([]);
});
