import type { InstallPlatform } from "@/lib/install";

/**
 * What to tell the user about installing, per platform.
 *
 * Not a client component: it renders text from a prop and holds no state, so
 * Settings can render it on the server. InstallPrompt, which does hold
 * state, passes the platform down.
 *
 * The iOS branch is the hand-built sheet the spec calls for. Safari fires no
 * beforeinstallprompt, so there is no button that can be offered and the
 * steps have to be written out. The wording names the Share control by its
 * label rather than describing the icon, because the icon is not
 * describable in a way that survives an iOS redesign.
 */
export function InstallInstructions({ platform }: { platform: InstallPlatform }) {
  if (platform === "installed") return null;

  if (platform === "ios") {
    return (
      <div className="text-[14px] text-body">
        <p className="mb-3">
          Add Overdue to your home screen to get notifications. On iOS, an app
          can only send them once it has been added.
        </p>
        <ol className="ml-4 list-decimal space-y-1 text-quiet">
          <li>Tap Share in the Safari toolbar.</li>
          <li>Scroll down and tap &quot;Add to Home Screen&quot;.</li>
          <li>Tap Add.</li>
          <li>Open Overdue from your home screen, then turn them on in Settings.</li>
        </ol>
      </div>
    );
  }

  if (platform === "prompt-capable") {
    return (
      <p className="text-[14px] text-body">
        Install Overdue to open it from your home screen or dock, and to keep
        your shelf readable without a connection.
      </p>
    );
  }

  return (
    <p className="text-[14px] text-quiet">
      This browser has not offered to install Overdue. Overdue works
      normally in the browser; only the home screen icon and notifications
      need an install.
    </p>
  );
}
