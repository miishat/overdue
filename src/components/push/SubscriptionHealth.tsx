import { formatElapsed } from "@/lib/provenance";

/**
 * The only fields Settings is allowed to see. `StoredSubscription` also
 * carries `p256dh`, `auth`, and `userId`, which are send-path secrets or
 * identity data that must never reach a client-rendered page. Callers
 * project explicit fields into this shape at the server boundary; never
 * spread a `StoredSubscription` into this component.
 */
export interface PublicSubscription {
  id: string;
  userAgent: string | null;
  createdAt: Date;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  failureCount: number;
}

interface Props {
  subscriptions: PublicSubscription[];
  now: Date;
}

type HealthState = "never-used" | "healthy" | "failing" | "stale";

// A subscription's success is treated as stale, rather than healthy, once it
// has gone this many days without a new success. This is the shape a push
// subscription takes when iOS has silently dropped it: it succeeded once,
// then nothing.
const STALE_AFTER_DAYS = 14;

function describe(sub: PublicSubscription, now: Date): { state: HealthState; label: string } {
  if (sub.lastSuccessAt === null) {
    return { state: "never-used", label: "Never used" };
  }

  if (sub.failureCount > 0) {
    const lastFailure = sub.lastFailureAt ?? sub.lastSuccessAt;
    return {
      state: "failing",
      label: `Failing (${sub.failureCount} ${sub.failureCount === 1 ? "failure" : "failures"}, last ${formatElapsed(lastFailure, now)} ago)`,
    };
  }

  const ageDays = Math.floor((now.getTime() - sub.lastSuccessAt.getTime()) / 86_400_000);
  if (ageDays >= STALE_AFTER_DAYS) {
    return {
      state: "stale",
      label: `Stale, last delivered ${formatElapsed(sub.lastSuccessAt, now)} ago`,
    };
  }

  return {
    state: "healthy",
    label: `Healthy, last delivered ${formatElapsed(sub.lastSuccessAt, now)} ago`,
  };
}

export function SubscriptionHealth({ subscriptions, now }: Props) {
  if (subscriptions.length === 0) {
    return (
      <p data-testid="subscription-health-empty" className="text-sm">
        No devices are set up for notifications yet. Turn them on below to
        see their status here.
      </p>
    );
  }

  return (
    <ul data-testid="subscription-health-list" className="flex flex-col gap-3">
      {subscriptions.map((sub) => {
        const { state, label } = describe(sub, now);
        return (
          <li
            key={sub.id}
            data-testid="subscription-health-row"
            data-state={state}
            className="flex flex-col gap-1 border-b border-rule pb-3"
          >
            <span className="text-sm">{sub.userAgent ?? "Unknown device"}</span>
            <span data-testid="subscription-health-label" className="text-sm">
              {label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
