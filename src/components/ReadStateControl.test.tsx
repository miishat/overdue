/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadStateControl } from "./ReadStateControl";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function select(): HTMLSelectElement {
  return screen.getByLabelText("Read state") as HTMLSelectElement;
}

describe("ReadStateControl", () => {
  it("updates the state on a successful save", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
    render(<ReadStateControl bookId="b1" initialState={null} />);
    fireEvent.change(select(), { target: { value: "reading" } });
    await waitFor(() => {
      expect(select().value).toBe("reading");
    });
  });

  it("shows an error and re-enables the control when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false } as Response));
    render(<ReadStateControl bookId="b1" initialState={null} />);
    fireEvent.change(select(), { target: { value: "reading" } });
    await waitFor(() => {
      expect(screen.getByText("Could not save that. Try again.")).toBeTruthy();
    });
    expect(select().disabled).toBe(false);
  });

  it("does not hang forever when fetch rejects, and surfaces an error instead", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<ReadStateControl bookId="b1" initialState={null} />);
    fireEvent.change(select(), { target: { value: "reading" } });
    await waitFor(() => {
      expect(screen.getByText("Could not save that. Try again.")).toBeTruthy();
    });
    // The select must come back enabled: a rejected fetch must not leave the
    // user's only control on the page permanently disabled.
    expect(select().disabled).toBe(false);
  });
});
