// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function define(key: string, value: unknown, target: object = navigator) {
  Object.defineProperty(target, key, { configurable: true, value });
}

function makePromptEvent(outcome: "accepted" | "dismissed") {
  const event = new Event("beforeinstallprompt") as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  };
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

beforeEach(() => {
  vi.resetModules();
  define("userAgent", "Mozilla/5.0 (Linux; Android 14) Chrome/126.0.0.0 Mobile Safari/537.36");
  define("platform", "Linux armv8l");
  define("maxTouchPoints", 5);
  define("standalone", undefined);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useInstallPrompt", () => {
  it("reports unsupported when no beforeinstallprompt has ever fired", async () => {
    const { useInstallPrompt } = await import("./useInstallPrompt");

    const { result } = renderHook(() => useInstallPrompt());

    await waitFor(() => expect(result.current.platform).toBe("unsupported"));
  });

  it("reports ios from the user agent even with no captured event", async () => {
    define("userAgent", IPHONE);
    define("platform", "iPhone");
    const { useInstallPrompt } = await import("./useInstallPrompt");

    const { result } = renderHook(() => useInstallPrompt());

    await waitFor(() => expect(result.current.platform).toBe("ios"));
  });

  it("becomes prompt-capable when the event fires after mount", async () => {
    const { useInstallPrompt } = await import("./useInstallPrompt");
    const { result } = renderHook(() => useInstallPrompt());
    await waitFor(() => expect(result.current.platform).toBe("unsupported"));

    await act(async () => {
      window.dispatchEvent(makePromptEvent("accepted"));
    });

    await waitFor(() => expect(result.current.platform).toBe("prompt-capable"));
  });

  it("catches an event that fired before the hook ever mounted", async () => {
    // The real failure this guards against: beforeinstallprompt fires early,
    // often before React has mounted a thing. A listener registered only in
    // an effect would miss it and the prompt would never appear.
    const installPromptModule = await import("./useInstallPrompt");
    window.dispatchEvent(makePromptEvent("accepted"));

    const { result } = renderHook(() => installPromptModule.useInstallPrompt());

    await waitFor(() => expect(result.current.platform).toBe("prompt-capable"));
  });

  it("returns the browser's outcome from promptToInstall", async () => {
    const { useInstallPrompt } = await import("./useInstallPrompt");
    const { result } = renderHook(() => useInstallPrompt());

    const event = makePromptEvent("accepted");
    await act(async () => {
      window.dispatchEvent(event);
    });

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.promptToInstall();
    });

    expect(outcome).toBe("accepted");
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable rather than throwing when there is nothing to prompt with", async () => {
    const { useInstallPrompt } = await import("./useInstallPrompt");
    const { result } = renderHook(() => useInstallPrompt());

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.promptToInstall();
    });

    expect(outcome).toBe("unavailable");
  });

  it("cannot be prompted with twice, because the browser only honours one call", async () => {
    const { useInstallPrompt } = await import("./useInstallPrompt");
    const { result } = renderHook(() => useInstallPrompt());

    const event = makePromptEvent("dismissed");
    await act(async () => {
      window.dispatchEvent(event);
    });

    await act(async () => {
      await result.current.promptToInstall();
      await result.current.promptToInstall();
    });

    expect(event.prompt).toHaveBeenCalledTimes(1);
  });
});
