/**
 * VAPID configuration for web push notifications.
 *
 * `readVapidConfig` returns `null` when the VAPID keys are not configured,
 * indicating that push notifications are not available in this environment.
 * This is not an error condition. Local development and CI may legitimately
 * run without push configured. Every caller must handle `null` gracefully
 * without crashing or showing an error page.
 *
 * The public key is safe to send to the browser (it is meant to be public).
 * The private key must never leave the server: not in client components,
 * response bodies, or logs.
 */

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * Read VAPID configuration from environment variables.
 * Returns null if any required key is missing, empty, or whitespace-only,
 * or if the subject is not a valid mailto: or https: URL.
 * @returns A complete VapidConfig, or null if push is not configured.
 */
export function readVapidConfig(env: NodeJS.ProcessEnv): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();

  // All three must be present and non-empty
  if (!publicKey || !privateKey || !subject) {
    return null;
  }

  // Subject must be a mailto: or https: URL
  if (!subject.startsWith("mailto:") && !subject.startsWith("https:")) {
    return null;
  }

  return {
    publicKey,
    privateKey,
    subject,
  };
}

/**
 * Check whether push notifications are configured.
 * @returns true only if a complete, valid VAPID configuration is present.
 */
export function isPushConfigured(env: NodeJS.ProcessEnv): boolean {
  return readVapidConfig(env) !== null;
}
