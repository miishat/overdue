import webpush, { WebPushError } from "web-push";
import { readVapidConfig } from "./vapid";
import type { PushPayload } from "./payload";
import type { StoredSubscription, SubscriptionStore } from "@/lib/push/subscriptions";

/**
 * The delivery mechanism, injected so tests never perform a real send.
 */
export interface PushTransport {
  send(subscription: StoredSubscription, payload: PushPayload): Promise<void>;
}

export interface SendResult {
  sent: number;
  failed: number;
  removed: number;
}

/**
 * The real transport, built from VAPID configuration read at call time. A
 * 404 or 410 status is the push service's way of saying the subscription no
 * longer exists (the user revoked permission, or iOS dropped it silently);
 * every other non-2xx status is surfaced as a generic failure so the caller
 * cannot tell dead-endpoint from transient-outage by parsing an error
 * message.
 *
 * Returns null when push is not configured, mirroring readVapidConfig, so
 * an unconfigured environment (local development, CI) produces a quiet
 * no-op transport rather than a thrown error.
 */
export function createWebPushTransport(env: NodeJS.ProcessEnv): PushTransport | null {
  const config = readVapidConfig(env);
  if (!config) {
    return null;
  }

  return {
    async send(subscription, payload) {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        JSON.stringify(payload),
        {
          vapidDetails: {
            subject: config.subject,
            publicKey: config.publicKey,
            privateKey: config.privateKey,
          },
        },
      );
    },
  };
}

/**
 * Status codes that mean the subscription is gone for good rather than
 * temporarily unreachable. Keeping a subscription at these statuses would
 * mean retrying a dead endpoint forever and showing a permanently unhealthy
 * row in Settings, so these are deleted instead of merely marked failed.
 */
const DEAD_SUBSCRIPTION_STATUSES = new Set([404, 410]);

function isDeadSubscriptionError(error: unknown): boolean {
  return error instanceof WebPushError && DEAD_SUBSCRIPTION_STATUSES.has(error.statusCode);
}

/**
 * Send one payload to every given subscription, recording per-subscription
 * health as it goes. Never throws: a transport failure for one subscription
 * is isolated to that subscription so the rest still send, and the VAPID
 * private key or any subscription's auth keys are never included in a log
 * line, only the subscription id.
 *
 * `transport` may be null (push not configured, see createWebPushTransport),
 * in which case this returns zeroes without attempting anything, so an
 * unconfigured environment is quiet rather than broken.
 */
export async function sendToAll(input: {
  subscriptions: StoredSubscription[];
  payload: PushPayload;
  transport: PushTransport | null;
  store: SubscriptionStore;
  now: Date;
}): Promise<SendResult> {
  const { subscriptions, payload, transport, store, now } = input;

  const result: SendResult = { sent: 0, failed: 0, removed: 0 };

  if (!transport) {
    return result;
  }

  for (const subscription of subscriptions) {
    try {
      await transport.send(subscription, payload);
      await store.recordSuccess(subscription.id, now);
      result.sent += 1;
    } catch (error) {
      try {
        if (isDeadSubscriptionError(error)) {
          await store.remove(subscription.userId, subscription.endpoint);
          result.removed += 1;
        } else {
          await store.recordFailure(subscription.id, now);
          result.failed += 1;
        }
      } catch (recordError) {
        // Recording the failure itself failed (for example a database
        // outage). This subscription is counted as failed, and the loop
        // still proceeds to the next subscription rather than throwing.
        console.error(
          `sendToAll: failed to record health for subscription ${subscription.id}: ${
            recordError instanceof Error ? recordError.message : String(recordError)
          }`,
        );
        result.failed += 1;
      }
      console.error(
        `sendToAll: send failed for subscription ${subscription.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return result;
}
