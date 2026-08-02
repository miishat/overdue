// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnablePush, urlBase64ToUint8Array } from "./EnablePush";

const VAPID_KEY =
  "BEl62iUYgUivxIkv69yViEuiBIa40HI0DLLuxazjqAKIpXxE3jhWtWDN0PQMwgxDsyEoJqchp6H7-gG0mQVdWvo";

const originalServiceWorker = Object.getOwnPropertyDescriptor(
  navigator,
  "serviceWorker",
);
const originalPushManager = (window as unknown as Record<string, unknown>)
  .PushManager;
const originalNotification = (window as unknown as Record<string, unknown>)
  .Notification;
const originalUserAgent = Object.getOwnPropertyDescriptor(
  navigator,
  "userAgent",
);
const originalPlatform = Object.getOwnPropertyDescriptor(
  navigator,
  "platform",
);
const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(
  navigator,
  "maxTouchPoints",
);
const originalStandalone = Object.getOwnPropertyDescriptor(
  navigator,
  "standalone",
);
const originalMatchMedia = window.matchMedia;

interface FakeSubscription {
  endpoint: string;
  toJSON: () => {
    endpoint: string;
    keys?: { p256dh?: string; auth?: string };
  };
}

function fakeSubscription(): FakeSubscription {
  return {
    endpoint: "https://push.example/abc123",
    toJSON: () => ({
      endpoint: "https://push.example/abc123",
      keys: { p256dh: "fake-p256dh", auth: "fake-auth" },
    }),
  };
}

interface PushSetupOptions {
  supported?: boolean;
  permission?: NotificationPermission;
  existingSubscription?: boolean;
  subscribeImpl?: () => Promise<FakeSubscription>;
  isIOS?: boolean;
  standalone?: boolean;
}

let requestPermissionMock: ReturnType<typeof vi.fn>;
let subscribeMock: ReturnType<typeof vi.fn>;
let getSubscriptionMock: ReturnType<typeof vi.fn>;

function setupPush(options: PushSetupOptions = {}) {
  const {
    supported = true,
    permission = "default",
    existingSubscription = false,
    subscribeImpl,
    isIOS = false,
    standalone = false,
  } = options;

  if (!supported) {
    Object.defineProperty(navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
    });
    delete (window as unknown as Record<string, unknown>).PushManager;
    delete (window as unknown as Record<string, unknown>).Notification;
    return;
  }

  (window as unknown as Record<string, unknown>).PushManager = class {};

  requestPermissionMock = vi.fn().mockResolvedValue("granted");
  subscribeMock = subscribeImpl
    ? vi.fn().mockImplementation(subscribeImpl)
    : vi.fn().mockResolvedValue(fakeSubscription());
  getSubscriptionMock = vi
    .fn()
    .mockResolvedValue(existingSubscription ? fakeSubscription() : undefined);

  (window as unknown as Record<string, unknown>).Notification = {
    permission,
    requestPermission: requestPermissionMock,
  };

  const registration = {
    pushManager: {
      subscribe: subscribeMock,
      getSubscription: getSubscriptionMock,
    },
  };

  Object.defineProperty(navigator, "serviceWorker", {
    value: {
      getRegistration: vi.fn().mockResolvedValue(registration),
      ready: Promise.resolve(registration),
    },
    configurable: true,
  });

  Object.defineProperty(navigator, "userAgent", {
    value: isIOS
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"
      : "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    configurable: true,
  });
  Object.defineProperty(navigator, "platform", {
    value: isIOS ? "iPhone" : "Win32",
    configurable: true,
  });
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: 0,
    configurable: true,
  });
  Object.defineProperty(navigator, "standalone", {
    value: standalone,
    configurable: true,
  });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: standalone && query.includes("standalone"),
    media: query,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function restorePush() {
  if (originalServiceWorker) {
    Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
  } else {
    delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  }
  if (originalPushManager === undefined) {
    delete (window as unknown as Record<string, unknown>).PushManager;
  } else {
    (window as unknown as Record<string, unknown>).PushManager =
      originalPushManager;
  }
  if (originalNotification === undefined) {
    delete (window as unknown as Record<string, unknown>).Notification;
  } else {
    (window as unknown as Record<string, unknown>).Notification =
      originalNotification;
  }
  if (originalUserAgent) {
    Object.defineProperty(navigator, "userAgent", originalUserAgent);
  }
  if (originalPlatform) {
    Object.defineProperty(navigator, "platform", originalPlatform);
  }
  if (originalMaxTouchPoints) {
    Object.defineProperty(
      navigator,
      "maxTouchPoints",
      originalMaxTouchPoints,
    );
  }
  if (originalStandalone) {
    Object.defineProperty(navigator, "standalone", originalStandalone);
  } else {
    delete (navigator as unknown as Record<string, unknown>).standalone;
  }
  window.matchMedia = originalMatchMedia;
}

describe("EnablePush", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    restorePush();
  });

  it("converts a base64url VAPID key into the correct byte sequence", () => {
    // Known vector: "cGFzcw" (base64url, no padding) is "pass" in ASCII.
    const result = urlBase64ToUint8Array("cGFzcw");
    expect(Array.from(result)).toEqual([112, 97, 115, 115]);
  });

  it("converts a key containing url-safe characters (- and _) correctly", () => {
    // base64 "Pj8/Pg==" (">?/?" no wait, let's use a controlled example)
    // "+/+/" in std base64 becomes "-_-_" in base64url.
    const std = "Pj8/Pg==";
    const urlSafe = "Pj8_Pg";
    const stdBytes = Uint8Array.from(atob(std), (c) => c.charCodeAt(0));
    const result = urlBase64ToUint8Array(urlSafe);
    expect(Array.from(result)).toEqual(Array.from(stdBytes));
  });

  it("shows an unsupported message when the browser lacks push APIs", async () => {
    setupPush({ supported: false });
    render(<EnablePush vapidPublicKey={VAPID_KEY} />);

    await waitFor(() => {
      expect(
        screen.getByText(/does not support push notifications/),
      ).toBeTruthy();
    });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a not-configured message when vapidPublicKey is null, even on a supporting browser", () => {
    setupPush({ supported: true, permission: "default" });
    render(<EnablePush vapidPublicKey={null} />);

    expect(
      screen.getByText(/not set up on this server yet/),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("invites the user to enable when permission is default", async () => {
    setupPush({ supported: true, permission: "default" });
    render(<EnablePush vapidPublicKey={VAPID_KEY} />);

    const button = await screen.findByRole("button", {
      name: "Turn on notifications",
    });
    expect(button).toBeTruthy();
    expect(
      screen.getByText(/Get notified when a tracked book/),
    ).toBeTruthy();
  });

  it("reports notifications as on when permission is granted and a subscription exists", async () => {
    setupPush({
      supported: true,
      permission: "granted",
      existingSubscription: true,
    });
    render(<EnablePush vapidPublicKey={VAPID_KEY} />);

    await waitFor(() => {
      expect(screen.getByText(/Notifications are on/)).toBeTruthy();
    });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("never renders the enable button when permission is denied", async () => {
    setupPush({ supported: true, permission: "denied" });
    render(<EnablePush vapidPublicKey={VAPID_KEY} />);

    await waitFor(() => {
      expect(screen.getByText(/blocked for this site/)).toBeTruthy();
    });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("tells iOS Safari users to install to the home screen when not standalone", async () => {
    setupPush({
      supported: true,
      permission: "default",
      isIOS: true,
      standalone: false,
    });
    render(<EnablePush vapidPublicKey={VAPID_KEY} />);

    await waitFor(() => {
      expect(screen.getByText(/Add this app to your home screen/)).toBeTruthy();
    });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("allows enabling on iOS Safari once installed to the home screen (standalone)", async () => {
    setupPush({
      supported: true,
      permission: "default",
      isIOS: true,
      standalone: true,
    });
    render(<EnablePush vapidPublicKey={VAPID_KEY} />);

    const button = await screen.findByRole("button", {
      name: "Turn on notifications",
    });
    expect(button).toBeTruthy();
  });

  it("posts the subscription to /api/push/subscribe exactly once on success, with a body matching the route contract", async () => {
    setupPush({ supported: true, permission: "default" });
    render(<EnablePush vapidPublicKey={VAPID_KEY} />);

    const button = await screen.findByRole("button", {
      name: "Turn on notifications",
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/Notifications are on/)).toBeTruthy();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/push/subscribe");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      endpoint: "https://push.example/abc123",
      p256dh: "fake-p256dh",
      auth: "fake-auth",
      userAgent: navigator.userAgent,
    });
  });

  it("shows an error and re-enables the control when the fetch is rejected", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    setupPush({ supported: true, permission: "default" });
    render(<EnablePush vapidPublicKey={VAPID_KEY} />);

    const button = await screen.findByRole("button", {
      name: "Turn on notifications",
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(
        screen.getByText("Could not turn on notifications. Try again."),
      ).toBeTruthy();
    });

    const buttonAfter = screen.getByRole("button", {
      name: "Turn on notifications",
    });
    expect(buttonAfter.hasAttribute("disabled")).toBe(false);
  });

  it("shows an error and re-enables the control when the server responds with a non-ok status", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    setupPush({ supported: true, permission: "default" });
    render(<EnablePush vapidPublicKey={VAPID_KEY} />);

    const button = await screen.findByRole("button", {
      name: "Turn on notifications",
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(
        screen.getByText("Could not turn on notifications. Try again."),
      ).toBeTruthy();
    });
    expect(
      screen.getByRole("button", { name: "Turn on notifications" })
        .hasAttribute("disabled"),
    ).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
