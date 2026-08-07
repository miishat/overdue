// Pure deployment-shield logic. No imports from next/*, no environment reads.
// The caller (src/proxy.ts) is responsible for reading process.env and the
// request. This function must never be treated as identity: it decides
// whether a request may reach the app at all, not who the requester is.
import { timingSafeEqual } from "node:crypto";

export type GateDecision =
  | { kind: "allow" }
  | { kind: "unlock" }
  | { kind: "deny" };

/**
 * True when there is no usable gate secret: unset, or present but blank.
 * evaluateGate below and src/proxy.ts's production warning both need this
 * exact condition and used to derive it separately, which could desync
 * silently since the two live in different files with their own tests.
 * Exported so both read the one definition. Still pure: it takes the value
 * as a parameter rather than reading process.env itself, so this file stays
 * free of environment reads and next/* imports.
 */
export function isGateSecretUnset(secret: string | undefined): boolean {
  return secret === undefined || secret.trim() === "";
}

export function evaluateGate(input: {
  secret: string | undefined;
  cookieValue: string | undefined;
  suppliedSecret: string | null;
}): GateDecision {
  const { secret, cookieValue, suppliedSecret } = input;

  if (isGateSecretUnset(secret)) {
    return { kind: "allow" };
  }
  if (secret === undefined) {
    // Unreachable: isGateSecretUnset(secret) above already excluded
    // undefined. Kept so TypeScript narrows secret to a plain string below
    // through a guard rather than a cast.
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
