// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISMISS_STORAGE_KEY, type InstallPlatform } from "@/lib/install";

const promptToInstall = vi.fn<() => Promise<"accepted" | "dismissed" | "unavailable">>();
const platform = vi.fn<() => InstallPlatform>();

vi.mock("@/hooks/useInstallPrompt", () => ({
  useInstallPrompt: () => ({ platform: platform(), promptToInstall }),
}));

import { InstallPrompt } from "./InstallPrompt";

beforeEach(() => {
  window.localStorage.clear();
  platform.mockReturnValue("ios");
  promptToInstall.mockResolvedValue("accepted");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InstallPrompt", () => {
  it("stays silent when nothing is tracked yet", async () => {
    const { container } = render(<InstallPrompt trackedCount={0} />);

    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("appears once something is tracked", async () => {
    render(<InstallPrompt trackedCount={1} />);

    await waitFor(() => expect(screen.getByTestId("install-prompt")).toBeTruthy());
  });

  it("stays silent when already installed", async () => {
    platform.mockReturnValue("installed");

    const { container } = render(<InstallPrompt trackedCount={5} />);

    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("stays silent where installation is impossible", async () => {
    platform.mockReturnValue("unsupported");

    const { container } = render(<InstallPrompt trackedCount={5} />);

    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("shows the hand-built steps on iOS and no install button", async () => {
    platform.mockReturnValue("ios");

    render(<InstallPrompt trackedCount={1} />);

    await waitFor(() => expect(screen.getByText(/Add to Home Screen/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("shows a real install button where the browser can prompt", async () => {
    platform.mockReturnValue("prompt-capable");

    render(<InstallPrompt trackedCount={1} />);

    const button = await screen.findByRole("button", { name: "Install" });
    fireEvent.click(button);

    await waitFor(() => expect(promptToInstall).toHaveBeenCalledTimes(1));
  });

  it("goes away and records the time when dismissed", async () => {
    render(<InstallPrompt trackedCount={1} />);
    const dismiss = await screen.findByRole("button", { name: "Not now" });

    fireEvent.click(dismiss);

    await waitFor(() => expect(screen.queryByTestId("install-prompt")).toBeNull());
    const stored = window.localStorage.getItem(DISMISS_STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(Number.isNaN(new Date(stored as string).getTime())).toBe(false);
  });

  it("stays dismissed on the next render", async () => {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, new Date().toISOString());

    const { container } = render(<InstallPrompt trackedCount={1} />);

    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("ignores a corrupt stored timestamp rather than staying silent forever", async () => {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, "not a date");

    render(<InstallPrompt trackedCount={1} />);

    await waitFor(() => expect(screen.getByTestId("install-prompt")).toBeTruthy());
  });

  it("goes away after a successful native install", async () => {
    platform.mockReturnValue("prompt-capable");
    promptToInstall.mockResolvedValue("accepted");

    render(<InstallPrompt trackedCount={1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));

    await waitFor(() => expect(screen.queryByTestId("install-prompt")).toBeNull());
  });

  it("treats a declined native prompt as a dismissal, so it does not nag", async () => {
    platform.mockReturnValue("prompt-capable");
    promptToInstall.mockResolvedValue("dismissed");

    render(<InstallPrompt trackedCount={1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));

    await waitFor(() => expect(screen.queryByTestId("install-prompt")).toBeNull());
    expect(window.localStorage.getItem(DISMISS_STORAGE_KEY)).not.toBeNull();
  });
});
