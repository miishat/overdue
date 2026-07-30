import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { READ_STATE_VALUES, type ReadStateValue } from "@/db/schema/enums";
import { readStates } from "@/db/schema/tracking";
import { getCurrentUserId } from "./current-user";

export interface ReadStateStore {
  get(userId: string, bookIds: string[]): Promise<Map<string, ReadStateValue>>;
  set(userId: string, bookId: string, state: ReadStateValue): Promise<void>;
}

/**
 * Narrowing guard rather than a cast, so an unknown value from a request body
 * cannot reach the database as a bad enum member.
 */
export function isReadStateValue(value: unknown): value is ReadStateValue {
  return (
    typeof value === "string" &&
    (READ_STATE_VALUES as readonly string[]).includes(value)
  );
}

export async function readStatesFor(
  bookIds: string[],
  store: ReadStateStore,
): Promise<Map<string, ReadStateValue>> {
  // Skip the round trip entirely for an empty shelf or an all-synthetic view.
  if (bookIds.length === 0) return new Map();
  const userId = await getCurrentUserId();
  return store.get(userId, bookIds);
}

export const drizzleReadStateStore: ReadStateStore = {
  async get(userId, bookIds) {
    const rows = await db
      .select({ bookId: readStates.bookId, state: readStates.state })
      .from(readStates)
      .where(
        and(eq(readStates.userId, userId), inArray(readStates.bookId, bookIds)),
      );

    const result = new Map<string, ReadStateValue>();
    for (const row of rows) {
      result.set(row.bookId, row.state);
    }
    return result;
  },

  async set(userId, bookId, state) {
    // read_states has a composite primary key on (user_id, book_id), so this
    // upsert targets that pair without needing a new migration.
    await db
      .insert(readStates)
      .values({ userId, bookId, state })
      .onConflictDoUpdate({
        target: [readStates.userId, readStates.bookId],
        set: { state, changedAt: new Date() },
      });
  },
};
