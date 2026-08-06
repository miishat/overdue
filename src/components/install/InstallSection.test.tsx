// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstallPlatform } from "@/lib/install";

const platform = vi.fn<() => InstallPlatform>();
vi.mock("@/hooks/useInstallPrompt", () => ({
  useInstallPrompt: () => ({ platform: platform(), promptToInstall: vi.fn() }),
}));

import { InstallSection } from "./InstallSection";

beforeEach(() => {
  platform.mockReturnValue("ios");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InstallSection", () => {
  it("shows the iOS steps regardless of any dismissal, unlike the prompt", async () => {
    render(<InstallSection />);

    await waitFor(() => expect(screen.getByText(/Add to Home Screen/)).toBeTruthy());
  });

  it("confirms the app is installed rather than showing nothing", async () => {
    platform.mockReturnValue("installed");

    render(<InstallSection />);

    await waitFor(() => expect(screen.getByText(/installed/i)).toBeTruthy());
  });

  it("says plainly when this browser has not offered to install", async () => {
    platform.mockReturnValue("unsupported");

    render(<InstallSection />);

    await waitFor(() => expect(screen.getByText(/has not offered/i)).toBeTruthy());
  });
});
