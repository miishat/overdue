"use client";

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
 * InstallInstructions renders null when installed, which would leave this
 * section as a bare heading with nothing under it, so the installed case is
 * handled here with a confirmation instead.
 */
export function InstallSection() {
  const { platform } = useInstallPrompt();

  if (platform === "installed") {
    return (
      <p className="text-[14px] text-body">
        Overdue is installed on this device.
      </p>
    );
  }

  return <InstallInstructions platform={platform} />;
}
