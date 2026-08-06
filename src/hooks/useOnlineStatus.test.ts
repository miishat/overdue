// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOnlineStatus } from "./useOnlineStatus";

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  setOnLine(true);
  vi.restoreAllMocks();
});

describe("useOnlineStatus", () => {
  it("starts optimistic rather than reading navigator during render", () => {
    // Server rendering has no navigator, and a first client render that
    // disagreed with the server's HTML would hydrate-mismatch. Starting at
    // true and correcting in an effect is the only shape that does not.
    setOnLine(false);

    const { result } = renderHook(() => useOnlineStatus());

    expect(typeof result.current).toBe("boolean");
  });

  it("reports offline once the effect has read navigator", () => {
    setOnLine(false);

    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current).toBe(false);
  });

  it("flips to false on the offline event", () => {
    setOnLine(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event("offline"));
    });

    expect(result.current).toBe(false);
  });

  it("flips back to true on the online event", () => {
    setOnLine(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);

    act(() => {
      setOnLine(true);
      window.dispatchEvent(new Event("online"));
    });

    expect(result.current).toBe(true);
  });

  it("removes both listeners on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useOnlineStatus());
    unmount();

    const events = remove.mock.calls.map((call) => call[0]);
    expect(events).toContain("online");
    expect(events).toContain("offline");
  });
});
