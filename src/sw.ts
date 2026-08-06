/// <reference lib="webworker" />

import { defaultCache } from "@serwist/next/worker";
import type {
  PrecacheEntry,
  RouteMatchCallbackOptions,
  SerwistGlobalConfig,
} from "serwist";
import { ExpirationPlugin, Serwist, StaleWhileRevalidate } from "serwist";
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

// Covers get their own rule, and it MUST come before defaultCache.
//
// Serwist matches runtimeCaching in order, first match wins. defaultCache
// contains a rule matching every same-origin GET under /api/ with a
// NetworkFirst capped at 16 entries (verified in
// node_modules/@serwist/next/dist/index.worker.mjs). A library is designed
// for 300 books, so leaving covers to that rule would evict all but the
// last 16 and offline browsing would show a wall of broken images.
//
// StaleWhileRevalidate rather than CacheFirst: a cached cover is served
// instantly and works with no network, and the background revalidation
// picks up a genuinely changed cover on the next visit. Offline, the
// revalidation just fails and the cached copy still rendered. CacheFirst
// would give the same offline behaviour but freeze a cover permanently,
// which matters because the proxy path is keyed by book id and the image
// behind it can change when the resolver picks a different source.
const coverCache = {
  matcher: ({ sameOrigin, url }: RouteMatchCallbackOptions) =>
    sameOrigin && url.pathname.startsWith("/api/covers/"),
  method: "GET" as const,
  handler: new StaleWhileRevalidate({
    cacheName: "book-covers",
    plugins: [
      new ExpirationPlugin({
        // Comfortably above the 300-book target the spec sets for Library,
        // so a full library never evicts itself mid-scroll.
        maxEntries: 400,
        maxAgeSeconds: 60 * 60 * 24 * 90,
        maxAgeFrom: "last-used",
        purgeOnQuotaError: true,
      }),
    ],
  }),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [coverCache, ...defaultCache],
  // Answers a failed navigation with the precached /offline page. This only
  // fires when a strategy could not produce a response at all, so a page the
  // user has already visited still comes back from defaultCache's "others"
  // NetworkFirst rather than being replaced by this.
  //
  // The matcher is narrowed to document requests on purpose: without it, a
  // failed image or script fetch would be answered with a page of HTML,
  // which is worse than a clean failure.
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
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
