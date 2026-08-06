"use client";

import { useEffect, useState } from "react";
import { detectInstallPlatform } from "@/lib/install";

interface Props {
  vapidPublicKey: string | null;
}

type Status =
  | "checking"
  | "unsupported"
  | "not-configured"
  | "ios-not-installed"
  | "denied"
  | "default"
  | "subscribed";

/**
 * Convert a base64url-encoded VAPID public key into the Uint8Array
 * pushManager.subscribe expects for applicationServerKey.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function detectStatus(): Promise<Status> {
  if (!isPushSupported()) {
    return "unsupported";
  }

  // One iOS heuristic in the codebase, in src/lib/install.ts. This used to be
  // a second copy living here, and two copies of an iPadOS tell will drift:
  // when they do, one screen offers push on a device where it cannot work
  // while the other refuses on a device where it can.
  const nav = navigator as Navigator & { standalone?: boolean };
  const platform = detectInstallPlatform({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone:
      nav.standalone === true ||
      (typeof window.matchMedia === "function" &&
        window.matchMedia("(display-mode: standalone)").matches),
    // Irrelevant to the branch this call cares about: an iOS device is
    // reported as "ios" whether or not a prompt event was captured.
    hasBeforeInstallPrompt: false,
  });

  if (platform === "ios") {
    return "ios-not-installed";
  }

  const permission = Notification.permission;
  if (permission === "denied") {
    return "denied";
  }
  if (permission === "default") {
    return "default";
  }
  // permission === "granted": find out whether a subscription already exists.
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    return subscription ? "subscribed" : "default";
  } catch {
    return "default";
  }
}

export function EnablePush({ vapidPublicKey }: Props) {
  const [status, setStatus] = useState<Status>(() =>
    vapidPublicKey === null ? "not-configured" : "checking",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (vapidPublicKey === null) {
      return;
    }
    let cancelled = false;
    detectStatus().then((result) => {
      if (!cancelled) {
        setStatus(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  async function handleEnable() {
    if (!vapidPublicKey) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        setStatus("denied");
        return;
      }
      if (permission !== "granted") {
        setStatus("default");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const json = subscription.toJSON();
      const endpoint = json.endpoint;
      const p256dh = json.keys?.p256dh;
      const auth = json.keys?.auth;
      if (!endpoint || !p256dh || !auth) {
        throw new Error("Subscription was missing required fields");
      }

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint,
          p256dh,
          auth,
          userAgent: navigator.userAgent,
        }),
      });

      if (!res.ok) {
        setError("Could not turn on notifications. Try again.");
        return;
      }

      setStatus("subscribed");
    } catch {
      setError("Could not turn on notifications. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (status === "checking") {
    return (
      <p data-testid="push-status" className="text-sm">
        Checking notification support...
      </p>
    );
  }

  if (status === "unsupported") {
    return (
      <p data-testid="push-status" className="text-sm">
        This browser does not support push notifications.
      </p>
    );
  }

  if (status === "not-configured") {
    return (
      <p data-testid="push-status" className="text-sm">
        Push notifications are not set up on this server yet.
      </p>
    );
  }

  if (status === "ios-not-installed") {
    return (
      <p data-testid="push-status" className="text-sm">
        Add this app to your home screen (Share, then &quot;Add to Home
        Screen&quot;) to enable notifications on iOS.
      </p>
    );
  }

  if (status === "denied") {
    return (
      <p data-testid="push-status" className="text-sm">
        Notifications are blocked for this site. Change this in your browser
        settings if you want to turn them on.
      </p>
    );
  }

  if (status === "subscribed") {
    return (
      <p data-testid="push-status" className="text-sm">
        Notifications are on for this device.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p data-testid="push-status" className="text-sm">
        Get notified when a tracked book or series has a new release date.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          void handleEnable();
        }}
        className="rounded-sm border px-3 py-2"
      >
        {pending ? "Turning on..." : "Turn on notifications"}
      </button>
      {error ? <p className="text-sm">{error}</p> : null}
    </div>
  );
}
