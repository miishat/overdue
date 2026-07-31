import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { books } from "./catalog";

describe("books", () => {
  it("records when the book's data was last refreshed", () => {
    const config = getTableConfig(books);
    const column = config.columns.find((c) => c.name === "last_refreshed_at");
    expect(column).toBeDefined();
    expect(column?.notNull).toBe(false);
  });
});
