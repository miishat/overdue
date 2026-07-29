import { describe, expect, it } from "vitest";
import { evaluateGate } from "./gate";

const SECRET = "correct-horse-battery-staple";

describe("evaluateGate", () => {
  it("allows when secret is unset", () => {
    expect(
      evaluateGate({ secret: undefined, cookieValue: undefined, suppliedSecret: null }),
    ).toEqual({ kind: "allow" });
  });

  it("allows when secret is an empty string", () => {
    expect(
      evaluateGate({ secret: "", cookieValue: undefined, suppliedSecret: null }),
    ).toEqual({ kind: "allow" });
  });

  it("allows when secret is whitespace only", () => {
    expect(
      evaluateGate({ secret: "   ", cookieValue: undefined, suppliedSecret: null }),
    ).toEqual({ kind: "allow" });
  });

  it("unlocks when the supplied secret matches", () => {
    expect(
      evaluateGate({ secret: SECRET, cookieValue: undefined, suppliedSecret: SECRET }),
    ).toEqual({ kind: "unlock" });
  });

  it("denies when the supplied secret is wrong", () => {
    expect(
      evaluateGate({ secret: SECRET, cookieValue: undefined, suppliedSecret: "wrong" }),
    ).toEqual({ kind: "deny" });
  });

  it("allows when the cookie matches", () => {
    expect(
      evaluateGate({ secret: SECRET, cookieValue: SECRET, suppliedSecret: null }),
    ).toEqual({ kind: "allow" });
  });

  it("denies when the cookie is wrong", () => {
    expect(
      evaluateGate({ secret: SECRET, cookieValue: "wrong", suppliedSecret: null }),
    ).toEqual({ kind: "deny" });
  });

  it("denies when the cookie is absent", () => {
    expect(
      evaluateGate({ secret: SECRET, cookieValue: undefined, suppliedSecret: null }),
    ).toEqual({ kind: "deny" });
  });

  it("denies when the supplied secret is a prefix of the real secret", () => {
    expect(
      evaluateGate({
        secret: SECRET,
        cookieValue: undefined,
        suppliedSecret: SECRET.slice(0, SECRET.length - 1),
      }),
    ).toEqual({ kind: "deny" });
  });

  it("denies when the cookie is a prefix of the real secret", () => {
    expect(
      evaluateGate({
        secret: SECRET,
        cookieValue: SECRET.slice(0, SECRET.length - 1),
        suppliedSecret: null,
      }),
    ).toEqual({ kind: "deny" });
  });

  it("prefers a correct supplied secret over a stale wrong cookie", () => {
    expect(
      evaluateGate({ secret: SECRET, cookieValue: "stale-wrong-cookie", suppliedSecret: SECRET }),
    ).toEqual({ kind: "unlock" });
  });
});
