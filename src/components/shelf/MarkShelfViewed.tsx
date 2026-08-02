"use client";

import { useEffect, useRef } from "react";

/**
 * Advances the shelf's "last viewed" baseline, after paint rather than
 * during render.
 *
 * Why a client effect and not a mark-as-viewed-while-rendering approach: a
 * server component cannot reliably run code after its response is sent, so
 * there is no server-side hook that fires strictly after the user has had a
 * chance to see the page. An effect does, at the cost of a few known gaps
 * (documented below), which are acceptable because the failure mode of each
 * is "the badge lingers one extra visit," never "a change gets lost."
 *
 * viewedAt is the timestamp the page was rendered with (passed down from the
 * server component), not client Date.now() read inside this effect. That
 * matters: if a change arrives in the gap between the server computing the
 * badges and this effect firing, using client "now" would advance the
 * baseline past it and the change would never be shown as changed. Using the
 * render-time timestamp keeps that gap on the safe side: any change that
 * lands after render, however narrow the window, still has an observedAt
 * after the new baseline and stays flagged for the next visit.
 *
 * Residual risks:
 * - If the tab closes before the effect fires (or before the fetch
 *   completes), the baseline never advances. `keepalive` lets the request
 *   outlive a navigation, but not a hard process kill. The cost is a stale
 *   badge reappearing next visit, not a missed change, since the DB baseline
 *   only ever moves forward from what was actually rendered.
 * - React StrictMode's dev double-invoke would double-fire this without the
 *   ref guard below. The guard is defense against a wasted request, not
 *   correctness: markViewed is a set, not an increment, so a duplicate call
 *   with the same viewedAt is harmless even without it.
 */
export function MarkShelfViewed({ viewedAt }: { viewedAt: Date }) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    void fetch("/api/shelf/viewed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ viewedAt: viewedAt.toISOString() }),
      keepalive: true,
    });
    // Fire-and-forget: the shelf has already rendered with the correct
    // badges for this visit, so nothing on screen depends on this request's
    // result. A failure here just means the badges do not clear until the
    // one after next.
  }, [viewedAt]);

  return null;
}
