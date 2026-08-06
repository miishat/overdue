"use client";

import { useCallback } from "react";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { InstallInstructions } from "./InstallInstructions";

/**
 * The permanent copy of the install instructions, for Settings.
 *
 * Unlike InstallPrompt this ignores dismissal and tracked count entirely. It
 * is not an offer, it is a reference: a user who dismissed the prompt and
 * later wants notifications needs a route back, and on iOS installation is a
 * hard prerequisite for push rather than a nicety.
 *
 * On prompt-capable, the route back is a real Install button, wired to
 * promptToInstall from the same useInstallPrompt hook InstallPrompt uses.
 * Without it, a Chrome user who dismissed the shelf offer had nothing to
 * click here for the next 30 days, which defeated the entire purpose of this
 * section. Deliberately not gated on dismissal or tracked count, same as the
 * rest of this component: it is a reference, not an offer.
 *
 * InstallInstructions renders null when installed, which would leave this
 * section as a bare heading with nothing under it, so the installed case is
 * handled here with a confirmation instead.
 */
export function InstallSection() {
  const { platform, promptToInstall } = useInstallPrompt();

  const install = useCallback(() => {
    void promptToInstall();
  }, [promptToInstall]);

  if (platform === "installed") {
    return (
      <p className="text-[14px] text-body">
        Overdue is installed on this device.
      </p>
    );
  }

  return (
    <>
      <InstallInstructions platform={platform} />
      {platform === "prompt-capable" ? (
        <button
          type="button"
          onClick={install}
          className="mt-4 rounded-sm border border-rule px-3 py-2 text-[13px] text-body"
        >
          Install
        </button>
      ) : null}
    </>
  );
}
