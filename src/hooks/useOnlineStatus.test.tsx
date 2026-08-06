// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
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
  it("never reads navigator during render, which would hydrate-mismatch", () => {
    // The server has no navigator. A hook that read it during render would
    // throw there, or produce first-client-render markup disagreeing with the
    // server's. renderToString does not run effects, so this isolates the
    // render pass: if the hook touches navigator.onLine at render time, this
    // throwing getter turns that into a visible failure instead of a silent
    // one that only shows up as a hydration warning in production.
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get() {
        throw new Error("navigator.onLine was read during render");
      },
    });

    function Probe() {
      useOnlineStatus();
      return null;
    }

    expect(() => renderToString(<Probe />)).not.toThrow();
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

  it("removes each listener with the same reference it added, or it leaks", () => {
    // removeEventListener only detaches when the event name AND the function
    // reference both match. Asserting on names alone would pass while leaking:
    // removing "offline" with the "online" handler's reference detaches
    // nothing, and the listener survives every unmount for the page's life.
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useOnlineStatus());

    const added = add.mock.calls.filter(
      ([event]) => event === "online" || event === "offline",
    );
    expect(added.map(([event]) => event).sort()).toEqual(["offline", "online"]);

    unmount();

    for (const [event, handler] of added) {
      expect(
        remove.mock.calls.some(([e, h]) => e === event && h === handler),
      ).toBe(true);
    }
  });
});
