/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkShelfViewed } from "./MarkShelfViewed";

afterEach(() => cleanup());

describe("MarkShelfViewed", () => {
  it("posts the timestamp from the viewedAt prop, not a freshly read Date.now()", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const propTime = new Date("2020-01-01T00:00:00.000Z");
    render(<MarkShelfViewed viewedAt={propTime} />);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string) as { viewedAt: string };
    expect(body.viewedAt).toBe(propTime.toISOString());

    vi.unstubAllGlobals();
  });

  it("sets keepalive on the fetch call", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<MarkShelfViewed viewedAt={new Date("2020-01-01T00:00:00.000Z")} />);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.keepalive).toBe(true);

    vi.unstubAllGlobals();
  });

  it("only posts once under a strict-mode double render/effect", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StrictMode>
        <MarkShelfViewed viewedAt={new Date("2020-01-01T00:00:00.000Z")} />
      </StrictMode>,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
