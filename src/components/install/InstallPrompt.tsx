"use client";

import { useCallback, useEffect, useState } from "react";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { DISMISS_STORAGE_KEY, shouldOfferInstall } from "@/lib/install";
import { InstallInstructions } from "./InstallInstructions";

function readDismissedAt(): Date | null {
  try {
    const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = new Date(raw);
    // A corrupt value must not silence the prompt forever. Treat it as never
    // dismissed, which is the behaviour that fails toward being useful.
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    // Private browsing modes can throw on localStorage access.
    return null;
  }
}

function writeDismissedAt(at: Date): void {
  try {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, at.toISOString());
  } catch {
    // Nothing to do. The prompt closes for this session either way, and the
    // worst case is that it returns on the next load.
  }
}

/**
 * The install prompt, shown on the Waiting Shelf only.
 *
 * trackedCount comes from the shelf's own already-loaded entries, so this
 * costs no extra query. The shelf is also the right place for it: it is the
 * screen the spec says matters, and a prompt on Settings would be an
 * instruction rather than an offer.
 *
 * Reads localStorage in an effect rather than during render. The server has
 * no localStorage, and a first client render that disagreed with the
 * server's HTML would hydrate-mismatch.
 *
 * A declined native prompt records a dismissal, same as tapping Not now.
 * Chrome will not honour a second prompt() on the same captured event
 * anyway, so continuing to show a button that can no longer do anything
 * would be a lie.
 */
export function InstallPrompt({ trackedCount }: { trackedCount: number }) {
  const { platform, promptToInstall } = useInstallPrompt();
  const [dismissedAt, setDismissedAt] = useState<Date | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissedAt(readDismissedAt());
    setReady(true);
  }, []);

  const dismiss = useCallback(() => {
    const now = new Date();
    writeDismissedAt(now);
    setDismissedAt(now);
  }, []);

  const install = useCallback(async () => {
    const outcome = await promptToInstall();
    if (outcome === "accepted") {
      // Nothing more to offer. The appinstalled listener in useInstallPrompt
      // will move platform to "installed" too, but closing here means the
      // prompt goes away even on a browser that does not fire it.
      setDismissedAt(new Date());
      return;
    }
    dismiss();
  }, [dismiss, promptToInstall]);

  if (!ready) return null;

  const offer = shouldOfferInstall({
    platform,
    trackedCount,
    dismissedAt,
    now: new Date(),
  });

  if (!offer) return null;

  return (
    <aside
      data-testid="install-prompt"
      aria-label="Install Overdue"
      className="mb-6 border border-rule bg-leaf p-4"
    >
      <InstallInstructions platform={platform} />
      <div className="mt-4 flex gap-3">
        {platform === "prompt-capable" ? (
          <button
            type="button"
            onClick={() => {
              void install();
            }}
            className="rounded-sm border border-rule px-3 py-2 text-[13px] text-body"
          >
            Install
          </button>
        ) : null}
        <button
          type="button"
          onClick={dismiss}
          className="rounded-sm px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-quiet"
        >
          Not now
        </button>
      </div>
    </aside>
  );
}
