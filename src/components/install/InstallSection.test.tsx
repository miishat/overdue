// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstallPlatform } from "@/lib/install";

const platform = vi.fn<() => InstallPlatform>();
const promptToInstall = vi.fn();
vi.mock("@/hooks/useInstallPrompt", () => ({
  useInstallPrompt: () => ({ platform: platform(), promptToInstall }),
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

  it("offers a real Install button when prompt-capable, wired to promptToInstall", async () => {
    platform.mockReturnValue("prompt-capable");

    render(<InstallSection />);

    const button = await screen.findByRole("button", { name: /install/i });
    fireEvent.click(button);

    expect(promptToInstall).toHaveBeenCalledTimes(1);
  });

  it("replaces the button with fallback copy once the prompt is unavailable", async () => {
    platform.mockReturnValue("prompt-capable");
    promptToInstall.mockResolvedValue("unavailable");

    render(<InstallSection />);

    const button = await screen.findByRole("button", { name: /install/i });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText(/will not prompt again/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
  });
});
