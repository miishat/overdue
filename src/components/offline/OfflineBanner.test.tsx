// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const useOnlineStatus = vi.fn<() => boolean>();
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => useOnlineStatus() }));

import { OfflineBanner } from "./OfflineBanner";

afterEach(cleanup);

describe("OfflineBanner", () => {
  it("renders nothing at all when online", () => {
    useOnlineStatus.mockReturnValue(true);

    const { container } = render(<OfflineBanner />);

    expect(container.innerHTML).toBe("");
  });

  it("says what the user is actually looking at when offline", () => {
    useOnlineStatus.mockReturnValue(false);

    render(<OfflineBanner />);

    expect(screen.getByText(/offline/i)).toBeTruthy();
    expect(screen.getByText(/last loaded/i)).toBeTruthy();
  });

  it("announces itself to assistive technology without stealing focus", () => {
    useOnlineStatus.mockReturnValue(false);

    render(<OfflineBanner />);

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
  });
});
