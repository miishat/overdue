"use client";

import { useCallback, useEffect, useState } from "react";
import { detectInstallPlatform, type InstallPlatform } from "@/lib/install";

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Module-level, and deliberately so.
 *
 * beforeinstallprompt fires once and early, frequently before React has
 * mounted anything at all. A listener registered inside an effect would miss
 * it on most loads and the prompt would silently never appear, which is
 * exactly the kind of failure nobody notices for a month. Registering at
 * import time means the event is captured whenever it arrives, and the hook
 * reads whatever was captured.
 *
 * The listeners are never removed. There is one module instance for the life
 * of the page and nothing to clean up.
 */
let captured: BeforeInstallPromptEvent | null = null;
let promptUsed = false;
const subscribers = new Set<() => void>();

function notify() {
  for (const subscriber of subscribers) subscriber();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Suppress Chrome's own mini-infobar so the app decides when to ask.
    // Spec section 10: never on first load.
    event.preventDefault();
    captured = event as BeforeInstallPromptEvent;
    promptUsed = false;
    notify();
  });

  window.addEventListener("appinstalled", () => {
    captured = null;
    promptUsed = true;
    notify();
  });
}

function readStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches)
  );
}

export function useInstallPrompt(): {
  platform: InstallPlatform;
  promptToInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
} {
  // Starts at "unsupported" rather than reading navigator during render, for
  // the same hydration reason as useOnlineStatus: the server has no
  // navigator, and "unsupported" renders nothing, so a mismatched first
  // frame is invisible.
  const [platform, setPlatform] = useState<InstallPlatform>("unsupported");

  useEffect(() => {
    const recompute = () => {
      setPlatform(
        detectInstallPlatform({
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          maxTouchPoints: navigator.maxTouchPoints,
          standalone: readStandalone(),
          hasBeforeInstallPrompt: captured !== null,
        }),
      );
    };

    recompute();
    subscribers.add(recompute);
    return () => {
      subscribers.delete(recompute);
    };
  }, []);

  const promptToInstall = useCallback(async () => {
    if (captured === null || promptUsed) return "unavailable" as const;
    // Set before awaiting: the browser honours exactly one prompt() call per
    // captured event, and a double tap would otherwise reach it twice.
    promptUsed = true;
    try {
      await captured.prompt();
      const choice = await captured.userChoice;
      return choice.outcome;
    } catch {
      return "unavailable" as const;
    }
  }, []);

  return { platform, promptToInstall };
}
