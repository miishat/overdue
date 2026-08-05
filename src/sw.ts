/// <reference lib="webworker" />

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";
import { isPushPayload } from "@/lib/notify/payload";

// Serwist's InjectManifest webpack plugin replaces this global with the
// list of precache entries at build time. It must stay declared even
// though nothing here assigns to it directly.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();

// isPushPayload and its PushPayload shape live in src/lib/notify/payload.ts,
// the shared contract with Task 11, which builds push payloads on the
// server. Both sides import that module rather than each defining the
// shape independently.

// Defensive by design: a malformed or empty payload must show nothing
// rather than throw. An exception inside a service worker is invisible
// to the user and hard to diagnose, so every failure path here just
// returns instead of raising.
self.addEventListener("push", (event: PushEvent) => {
  const showNotification = async (): Promise<void> => {
    if (!event.data) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = event.data.json();
    } catch {
      return;
    }

    if (!isPushPayload(parsed)) {
      return;
    }

    const url = parsed.url ?? "/";

    try {
      await self.registration.showNotification(parsed.title, {
        body: parsed.body,
        tag: parsed.tag,
        data: { url },
      });
    } catch {
      // Showing the notification failed; there is nothing more we can
      // safely do inside the service worker, so we swallow it.
    }
  };

  event.waitUntil(showNotification());
});

// Focus an existing window on the notification's URL if one is open,
// otherwise open a new one. Defensive for the same reason as the push
// handler: nothing here should throw and go unnoticed.
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();

  const focusOrOpen = async (): Promise<void> => {
    try {
      const data = event.notification.data as { url?: unknown } | undefined;
      const rawUrl =
        typeof data?.url === "string" && data.url.length > 0
          ? data.url
          : "/";
      const resolved = new URL(rawUrl, self.location.origin);

      // The payload url is server-controlled today, but only ever open a
      // same-origin URL, since this runs with the ability to focus and
      // navigate the user's open windows.
      const targetUrl =
        resolved.origin === self.location.origin
          ? resolved.href
          : self.location.origin + "/";

      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of windows) {
        if (client.url === targetUrl && "focus" in client) {
          await client.focus();
          return;
        }
      }

      for (const client of windows) {
        if ("focus" in client && "navigate" in client) {
          await client.focus();
          await (client as WindowClient).navigate(targetUrl);
          return;
        }
      }

      await self.clients.openWindow(targetUrl);
    } catch {
      // Nothing here should throw and go unnoticed: a cross-origin
      // navigate() rejection or a malformed URL must not surface as an
      // unhandled rejection inside the service worker.
    }
  };

  event.waitUntil(focusOrOpen());
});
