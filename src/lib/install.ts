/**
 * Pure rules for when and how to offer installation.
 *
 * Everything here takes its inputs as parameters. Nothing reads navigator,
 * window, or localStorage, which is what makes the whole state machine
 * testable as a table rather than through a pile of jsdom property
 * redefinitions.
 *
 * The iPadOS heuristic was first written inside
 * src/components/push/EnablePush.tsx for M3, where iOS install state decides
 * whether push is even possible. It lives here now so there is one copy.
 */

export type InstallPlatform = "ios" | "prompt-capable" | "installed" | "unsupported";

export interface InstallEnvironment {
  userAgent: string;
  /** navigator.platform. Deprecated, and still the only iPadOS tell there is. */
  platform: string;
  maxTouchPoints: number;
  /** Already running as an installed app. */
  standalone: boolean;
  /** A beforeinstallprompt event has been captured. */
  hasBeforeInstallPrompt: boolean;
}

export interface OfferInput {
  platform: InstallPlatform;
  /** How many things the user is tracking. Zero means never prompt. */
  trackedCount: number;
  dismissedAt: Date | null;
  now: Date;
}

export const DISMISS_COOLDOWN_DAYS = 30;

export const DISMISS_STORAGE_KEY = "overdue.install.dismissedAt";

const COOLDOWN_MS = DISMISS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export function detectInstallPlatform(env: InstallEnvironment): InstallPlatform {
  // Checked first and unconditionally. An installed app has nothing left to
  // be offered, and on iOS the standalone check is also what tells us the
  // user already followed the instructions.
  if (env.standalone) return "installed";

  const isIOS =
    /iPad|iPhone|iPod/.test(env.userAgent) ||
    // iPadOS 13+ reports a desktop Safari user agent and platform. A real
    // Mac reports maxTouchPoints 0, so touch support is the discriminator.
    (env.platform === "MacIntel" && env.maxTouchPoints > 1);

  // Before the beforeinstallprompt check, not after: Safari never fires that
  // event, so an iOS device would otherwise fall through to "unsupported"
  // and never see the instruction sheet that is its only route to
  // installation, and therefore to push.
  if (isIOS) return "ios";

  if (env.hasBeforeInstallPrompt) return "prompt-capable";

  return "unsupported";
}

export function shouldOfferInstall(input: OfferInput): boolean {
  if (input.platform === "installed" || input.platform === "unsupported") {
    return false;
  }

  // Spec section 10: never on first load. Tracking something is the signal
  // that the app has earned a place on the home screen.
  if (input.trackedCount < 1) return false;

  if (input.dismissedAt !== null) {
    const elapsed = input.now.getTime() - input.dismissedAt.getTime();
    // A negative elapsed means the stored timestamp is in the future, from a
    // clock change or a hand-edited value. Treat it as a live dismissal so
    // the prompt stays quiet, but never as permanent: once the clock passes
    // it and the cooldown elapses, the normal rule takes over again.
    if (elapsed <= COOLDOWN_MS) return false;
  }

  return true;
}
