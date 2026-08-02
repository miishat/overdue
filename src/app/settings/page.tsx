import { EnablePush } from "@/components/push/EnablePush";
import {
  PublicSubscription,
  SubscriptionHealth,
  toPublicSubscription,
} from "@/components/push/SubscriptionHealth";
import { getCurrentUserId } from "@/lib/current-user";
import { readVapidConfig } from "@/lib/notify/vapid";
import { drizzleSubscriptionStore } from "@/lib/push/subscriptions";

// Settings reads subscription health from the database on every visit, same
// reasoning as Library and the Waiting shelf: a static build would freeze
// health readings at build time, which defeats the entire point of a page
// meant to show a subscription going stale in real time. See
// src/app/page.tsx and node_modules/next/dist/docs/01-app/02-guides/
// caching-without-cache-components.md, "Route segment config" > `dynamic`.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const now = new Date();
  const userId = await getCurrentUserId();
  const stored = await drizzleSubscriptionStore.listFor(userId);

  // Explicit projection at the server boundary: p256dh, auth, and userId
  // are secrets or identity data the send path needs and Settings does
  // not. toPublicSubscription is the pinned, tested projection; never
  // spread a StoredSubscription into a client component prop.
  const subscriptions: PublicSubscription[] = stored.map(toPublicSubscription);

  const vapidConfig = readVapidConfig(process.env);
  const vapidPublicKey = vapidConfig?.publicKey ?? null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 font-display text-[26px] text-body">Settings</h1>
      <section className="mb-8">
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wide text-quiet">
          Notifications
        </h2>
        <EnablePush vapidPublicKey={vapidPublicKey} />
      </section>
      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wide text-quiet">
          Device health
        </h2>
        <SubscriptionHealth subscriptions={subscriptions} now={now} />
      </section>
    </main>
  );
}
