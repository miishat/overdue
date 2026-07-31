/// <reference lib="webworker" />

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

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

// The shape below is the shared contract with Task 11, which builds push
// payloads on the server as { title, body, url, tag }. Both sides must
// agree on this shape; there is no schema between them, only this comment
// and the two implementations.
interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}

function isPushPayload(value: unknown): value is PushPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.title !== "string" || candidate.title.length === 0) {
    return false;
  }
  if (candidate.body !== undefined && typeof candidate.body !== "string") {
    return false;
  }
  if (candidate.url !== undefined && typeof candidate.url !== "string") {
    return false;
  }
  if (candidate.tag !== undefined && typeof candidate.tag !== "string") {
    return false;
  }
  return true;
}

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

  const data = event.notification.data as { url?: unknown } | undefined;
  const url = typeof data?.url === "string" && data.url.length > 0 ? data.url : "/";
  const targetUrl = new URL(url, self.location.origin).href;

  const focusOrOpen = async (): Promise<void> => {
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
  };

  event.waitUntil(focusOrOpen());
});
