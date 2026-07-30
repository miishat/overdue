// Pure deployment-shield logic. No imports from next/*, no environment reads.
// The caller (src/proxy.ts) is responsible for reading process.env and the
// request. This function must never be treated as identity: it decides
// whether a request may reach the app at all, not who the requester is.
import { timingSafeEqual } from "node:crypto";

export type GateDecision =
  | { kind: "allow" }
  | { kind: "unlock" }
  | { kind: "deny" };

export function evaluateGate(input: {
  secret: string | undefined;
  cookieValue: string | undefined;
  suppliedSecret: string | null;
}): GateDecision {
  const { secret, cookieValue, suppliedSecret } = input;

  if (secret === undefined || secret.trim() === "") {
    return { kind: "allow" };
  }

  if (constantTimeEquals(suppliedSecret ?? undefined, secret)) {
    return { kind: "unlock" };
  }

  if (constantTimeEquals(cookieValue, secret)) {
    return { kind: "allow" };
  }

  return { kind: "deny" };
}

function constantTimeEquals(a: string | undefined, b: string): boolean {
  if (a === undefined) {
    return false;
  }

  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}
