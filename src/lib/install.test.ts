import { describe, expect, it } from "vitest";
import {
  DISMISS_COOLDOWN_DAYS,
  detectInstallPlatform,
  shouldOfferInstall,
  type InstallEnvironment,
  type InstallPlatform,
} from "./install";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const FIREFOX_DESKTOP =
  "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";

function env(over: Partial<InstallEnvironment> = {}): InstallEnvironment {
  return {
    userAgent: CHROME_ANDROID,
    platform: "Linux armv8l",
    maxTouchPoints: 5,
    standalone: false,
    hasBeforeInstallPrompt: true,
    ...over,
  };
}

describe("detectInstallPlatform", () => {
  it("reports installed first, whatever the platform, because there is nothing left to offer", () => {
    expect(detectInstallPlatform(env({ standalone: true }))).toBe("installed");
    expect(
      detectInstallPlatform(env({ userAgent: IPHONE, platform: "iPhone", standalone: true })),
    ).toBe("installed");
  });

  it("recognises an iPhone", () => {
    expect(detectInstallPlatform(env({ userAgent: IPHONE, platform: "iPhone" }))).toBe("ios");
  });

  it("recognises an iPad that lies about being a Mac", () => {
    // iPadOS 13+ reports a desktop Safari user agent. Touch points is the
    // only reliable tell: a real Mac reports 0.
    expect(
      detectInstallPlatform(
        env({ userAgent: IPAD_AS_MAC, platform: "MacIntel", maxTouchPoints: 5 }),
      ),
    ).toBe("ios");
  });

  it("does not mistake a real Mac for an iPad", () => {
    expect(
      detectInstallPlatform(
        env({
          userAgent: IPAD_AS_MAC,
          platform: "MacIntel",
          maxTouchPoints: 0,
          hasBeforeInstallPrompt: false,
        }),
      ),
    ).toBe("unsupported");
  });

  it("reports ios even though iOS never fires beforeinstallprompt", () => {
    expect(
      detectInstallPlatform(
        env({ userAgent: IPHONE, platform: "iPhone", hasBeforeInstallPrompt: false }),
      ),
    ).toBe("ios");
  });

  it("reports prompt-capable where the browser offers the native prompt", () => {
    expect(detectInstallPlatform(env({ hasBeforeInstallPrompt: true }))).toBe("prompt-capable");
  });

  it("reports unsupported for a browser with neither route to installation", () => {
    expect(
      detectInstallPlatform(
        env({
          userAgent: FIREFOX_DESKTOP,
          platform: "Linux x86_64",
          maxTouchPoints: 0,
          hasBeforeInstallPrompt: false,
        }),
      ),
    ).toBe("unsupported");
  });
});

describe("shouldOfferInstall", () => {
  const now = new Date("2026-08-05T12:00:00.000Z");

  function offer(over: Partial<Parameters<typeof shouldOfferInstall>[0]> = {}) {
    return shouldOfferInstall({
      platform: "ios" as InstallPlatform,
      trackedCount: 1,
      dismissedAt: null,
      now,
      ...over,
    });
  }

  it("never offers before the user has tracked anything", () => {
    // Spec section 10: "The install prompt appears only after the user has
    // tracked something. Never on first load."
    expect(offer({ trackedCount: 0 })).toBe(false);
    expect(offer({ platform: "prompt-capable", trackedCount: 0 })).toBe(false);
  });

  it("offers on iOS once something is tracked", () => {
    expect(offer({ platform: "ios", trackedCount: 1 })).toBe(true);
  });

  it("offers where the native prompt is available once something is tracked", () => {
    expect(offer({ platform: "prompt-capable", trackedCount: 3 })).toBe(true);
  });

  it("never offers when already installed", () => {
    expect(offer({ platform: "installed", trackedCount: 99 })).toBe(false);
  });

  it("never offers where installation is not possible", () => {
    expect(offer({ platform: "unsupported", trackedCount: 99 })).toBe(false);
  });

  it("stays quiet inside the cooldown after a dismissal", () => {
    const dismissedAt = new Date("2026-08-04T12:00:00.000Z");
    expect(offer({ dismissedAt })).toBe(false);
  });

  it("offers again once the cooldown has fully elapsed", () => {
    const dismissedAt = new Date(
      now.getTime() - (DISMISS_COOLDOWN_DAYS + 1) * 24 * 60 * 60 * 1000,
    );
    expect(offer({ dismissedAt })).toBe(true);
  });

  it("treats the exact cooldown boundary as still dismissed", () => {
    const dismissedAt = new Date(now.getTime() - DISMISS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    expect(offer({ dismissedAt })).toBe(false);
  });

  it("ignores a dismissal timestamp in the future rather than being silenced forever", () => {
    // A clock change or a hand-edited localStorage value must not be able to
    // suppress the prompt permanently.
    const dismissedAt = new Date("2030-01-01T00:00:00.000Z");
    expect(offer({ dismissedAt })).toBe(false);
    expect(offer({ dismissedAt, now: new Date("2030-03-01T00:00:00.000Z") })).toBe(true);
  });
});
