import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("the web app manifest", () => {
  it("declares a stable id, so changing start_url does not create a second app", () => {
    expect(manifest().id).toBe("/");
  });

  it("declares a scope, so an off-scope link opens in the browser rather than the app frame", () => {
    expect(manifest().scope).toBe("/");
  });

  it("still declares the three icons install needs", () => {
    const icons = manifest().icons ?? [];
    expect(icons.map((icon) => icon.src)).toEqual([
      "/icon-192.png",
      "/icon-512.png",
      "/icon-maskable-512.png",
    ]);
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("takes its colours from the palette rather than a hardcoded hex", async () => {
    const { PALETTE } = await import("@/lib/tokens");
    expect(manifest().theme_color).toBe(PALETTE.dark.ink);
    expect(manifest().background_color).toBe(PALETTE.dark.ink);
  });
});
