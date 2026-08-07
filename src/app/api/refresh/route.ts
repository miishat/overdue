import { timingSafeEqual } from "node:crypto";
import { getCurrentUserId } from "@/lib/current-user";
import { drainQueue, type DrainResult } from "@/lib/notify/drain";
import { drizzleNotificationQueue } from "@/lib/notify/queue";
import { createWebPushTransport } from "@/lib/notify/send";
import { drizzleSubscriptionStore } from "@/lib/push/subscriptions";
import { drizzleDiscoveryPort } from "@/lib/refresh/discovery-port";
import { runSeriesDiscovery } from "@/lib/refresh/discovery-run";
import { drizzleRefreshPort } from "@/lib/refresh/port";
import { runRefresh } from "@/lib/refresh/run";

const EMPTY_DRAIN_RESULT: DrainResult = { claimed: 0, sent: 0, failed: 0 };

/**
 * Drains the notification queue after a refresh, in the same request.
 * Doing both in one call keeps the scheduled workflow to a single HTTP call
 * and means a run either completes or fails visibly, rather than leaving
 * notifications stranded behind a second scheduled job that might not fire.
 *
 * Returns quietly (an empty result) when push is not configured, mirroring
 * createWebPushTransport's own null contract: local development and CI stay
 * quiet rather than erroring.
 *
 * Never throws. A drain failure must not turn a successful refresh into a
 * 500, since recording changes is the more important half of the job and has
 * already succeeded by the time this runs.
 */
async function runDrain(now: Date): Promise<DrainResult> {
  try {
    const transport = createWebPushTransport(process.env);
    if (!transport) {
      return EMPTY_DRAIN_RESULT;
    }

    const userId = await getCurrentUserId();
    const subscriptions = await drizzleSubscriptionStore.listFor(userId);

    return await drainQueue({
      userId,
      queue: drizzleNotificationQueue,
      subscriptions,
      transport,
      store: drizzleSubscriptionStore,
      now,
    });
  } catch (error) {
    console.error(
      `refresh: drain failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return EMPTY_DRAIN_RESULT;
  }
}

// Mirrors src/lib/gate.ts's constantTimeEquals exactly: a length guard before
// timingSafeEqual, since timingSafeEqual throws on mismatched buffer lengths
// rather than returning false.
function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}

function isAuthorised(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization");
  if (!header) return false;

  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;

  const supplied = header.slice(prefix.length);
  return constantTimeEquals(supplied, secret);
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;

  // Unset is the opposite default of the deployment gate: a gate with no
  // secret is inert and harmless on a dev machine, but a refresh endpoint
  // with no secret is an open door to a job that makes dozens of provider
  // calls. So a missing secret refuses every request rather than letting
  // one through unauthenticated.
  if (secret === undefined || secret.trim() === "") {
    return Response.json({ error: "Refresh endpoint is not configured" }, {
      status: 503,
    });
  }

  if (!isAuthorised(request, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const result = await runRefresh(drizzleRefreshPort, now);

  // Series discovery runs in the same scheduled job as book refresh, not as
  // a one-off at track time. This is what closes the spec gap in section 8
  // ("the app owns discovering new entries... the user never adds book five
  // manually"): a series announced after it was tracked, or a track-time
  // discovery cut short by after()'s finite budget, is completed here on the
  // next run instead of never again. See discovery-run.ts for the failure
  // isolation (one bad series does not stop the rest) and discovery-slice.ts
  // for the bound.
  //
  // Runs after book refresh, before the drain, so any future notification
  // work discovery does would still be queued before the drain reads the
  // queue. Not wrapped in a try/catch the way runDrain is: a hard failure
  // here (e.g. unable to even list tracked series) is core job work, exactly
  // like a hard failure from runRefresh's own candidates() call, and both are
  // allowed to surface as a 500 rather than being swallowed.
  const discoveryResult = await runSeriesDiscovery(drizzleDiscoveryPort, now);

  // The drain runs after the refresh, not before: an alert must never be
  // sent for a change whose history row has not been durably written yet.
  const drainResult = await runDrain(now);

  // Counts only. Never echo request headers or anything derived from the
  // secret comparison, and never include per-failure provider error text
  // that might leak details about the deployment.
  return Response.json(
    {
      examined: result.examined,
      changed: result.changed,
      changeRows: result.changeRows,
      failures: result.failures.length,
      seriesExamined: discoveryResult.seriesExamined,
      entriesFound: discoveryResult.entriesFound,
      entriesPersisted: discoveryResult.entriesPersisted,
      discoveryFailures: discoveryResult.failures.length,
      notificationsClaimed: drainResult.claimed,
      notificationsSent: drainResult.sent,
      notificationsFailed: drainResult.failed,
    },
    { status: 200 },
  );
}

export async function GET(): Promise<Response> {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
