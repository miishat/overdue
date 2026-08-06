import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline",
};

/**
 * The service worker's navigation fallback.
 *
 * Shown only when a navigation cannot be served from the network or from the
 * runtime cache, which in practice means a page the user has never opened
 * while online. Pages they have opened come back from the "others"
 * NetworkFirst cache instead and never reach here.
 *
 * Three hard constraints, all of which exist because this renders with no
 * network at all:
 *   - no database access
 *   - no `export const dynamic`, so `next build` prerenders it and the
 *     service worker can precache a complete page
 *   - no client components
 *
 * The copy follows the spec's rule for empty states: an invitation to act,
 * not an apology. It says what still works rather than only what does not.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-4 font-display text-[26px] text-body">You are offline</h1>
      <p className="mb-3 text-[14px] text-body">
        This page has not been opened on this device yet, so there is no copy
        of it here.
      </p>
      <p className="mb-6 text-[14px] text-quiet">
        Anything you have already opened is still readable, including your
        shelf and any book you have looked at. Release dates will be whatever
        they were the last time this device was online.
      </p>
      <Link
        href="/"
        className="font-mono text-[11px] uppercase tracking-wide text-verdigris"
      >
        Back to the waiting shelf
      </Link>
    </main>
  );
}
