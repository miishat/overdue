"use client";

import { useOnlineStatus } from "@/hooks/useOnlineStatus";

/**
 * A quiet strip stating that what is on screen came from cache.
 *
 * Same argument as M3's subscription health: this app's whole claim is that
 * it is honest about what it knows and when it last checked. Serving a
 * six-day-old release date with no indication that it is six days old
 * because the phone is on a train would be the exact dishonesty the product
 * exists to prevent.
 *
 * role="status" with aria-live="polite" so a screen reader hears it at the
 * next pause rather than being interrupted, and nothing steals focus.
 *
 * Colour is not carrying the meaning here; the text does. Consistent with
 * the spec's rule that status is never communicated by colour alone.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      className="border-b border-rule bg-leaf px-4 py-2 text-center font-mono text-[11px] uppercase tracking-wide text-quiet"
    >
      Offline. Showing what was last loaded on this device.
    </div>
  );
}
