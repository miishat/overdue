import { beforeAll, describe, expect, it } from "vitest";

// db/client.ts throws if DATABASE_URL is unset, and it is reached
// transitively through tracks.ts (isValidClientReleaseDate), which
// catalog-input.ts imports. A static top-level import of catalog-input.ts
// here would be hoisted ahead of this assignment by ES module evaluation
// order, so the module is instead loaded dynamically in beforeAll, once
// this placeholder is guaranteed to already be set. Mirrors the same
// workaround in src/lib/tracks.test.ts.
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

let catalogInput: typeof import("./catalog-input");

beforeAll(async () => {
  catalogInput = await import("./catalog-input");
});

function baseBook(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: "isbn:9780008501815",
    title: "Babel",
    authors: ["R. F. Kuang"],
    provenance: {},
    sources: [{ provider: "hardcover", externalId: "12345" }],
    confidence: 80,
    ...overrides,
  };
}

describe("isProviderName", () => {
  it.each(["manual", "hardcover", "wikidata", "openlibrary", "google"])(
    "accepts %s",
    (name) => {
      expect(catalogInput.isProviderName(name)).toBe(true);
    },
  );

  it("rejects an unknown provider string", () => {
    expect(catalogInput.isProviderName("bookshop")).toBe(false);
  });

  it("rejects non-string values without throwing", () => {
    expect(catalogInput.isProviderName(42)).toBe(false);
    expect(catalogInput.isProviderName(null)).toBe(false);
    expect(catalogInput.isProviderName(undefined)).toBe(false);
    expect(catalogInput.isProviderName({})).toBe(false);
  });
});

describe("isDatePrecisionValue", () => {
  it.each(["day", "month", "quarter", "season", "year"])("accepts %s", (p) => {
    expect(catalogInput.isDatePrecisionValue(p)).toBe(true);
  });

  it("rejects an unknown precision string", () => {
    expect(catalogInput.isDatePrecisionValue("decade")).toBe(false);
  });

  it("rejects non-string values without throwing", () => {
    expect(catalogInput.isDatePrecisionValue(11)).toBe(false);
    expect(catalogInput.isDatePrecisionValue(null)).toBe(false);
  });
});

describe("validateTrackBook", () => {
  it("accepts a well-formed minimal book", () => {
    const result = catalogInput.validateTrackBook(baseBook());
    expect(result.ok).toBe(true);
  });

  it("rejects a non-object value", () => {
    expect(catalogInput.validateTrackBook("not an object").ok).toBe(false);
    expect(catalogInput.validateTrackBook(null).ok).toBe(false);
    expect(catalogInput.validateTrackBook(undefined).ok).toBe(false);
    expect(catalogInput.validateTrackBook([]).ok).toBe(false);
  });

  it("rejects a missing title", () => {
    const book = baseBook();
    delete book.title;
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("rejects an empty or whitespace-only title", () => {
    expect(catalogInput.validateTrackBook(baseBook({ title: "" })).ok).toBe(false);
    expect(catalogInput.validateTrackBook(baseBook({ title: "   " })).ok).toBe(false);
  });

  it("rejects a title longer than the maximum", () => {
    const book = baseBook({ title: "x".repeat(catalogInput.MAX_TITLE_LENGTH + 1) });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("accepts a title at exactly the maximum length", () => {
    const book = baseBook({ title: "x".repeat(catalogInput.MAX_TITLE_LENGTH) });
    expect(catalogInput.validateTrackBook(book).ok).toBe(true);
  });

  it("rejects a missing or empty key", () => {
    const book = baseBook();
    delete book.key;
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
    expect(catalogInput.validateTrackBook(baseBook({ key: "" })).ok).toBe(false);
  });

  it("rejects authors that is not an array", () => {
    expect(catalogInput.validateTrackBook(baseBook({ authors: "R. F. Kuang" })).ok).toBe(
      false,
    );
  });

  it("rejects more authors than the maximum", () => {
    const book = baseBook({
      authors: Array.from({ length: catalogInput.MAX_AUTHORS + 1 }, (_, i) => `Author ${i}`),
    });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("rejects a non-string entry in authors", () => {
    expect(catalogInput.validateTrackBook(baseBook({ authors: ["Real Name", 5] })).ok).toBe(
      false,
    );
  });

  it("rejects an author name longer than the maximum", () => {
    const book = baseBook({ authors: ["x".repeat(catalogInput.MAX_AUTHOR_NAME_LENGTH + 1)] });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("accepts an empty authors array", () => {
    expect(catalogInput.validateTrackBook(baseBook({ authors: [] })).ok).toBe(true);
  });

  it("rejects sources that is not an array", () => {
    expect(catalogInput.validateTrackBook(baseBook({ sources: "hardcover:1" })).ok).toBe(
      false,
    );
  });

  it("rejects more sources than the maximum", () => {
    const book = baseBook({
      sources: Array.from({ length: catalogInput.MAX_SOURCES + 1 }, (_, i) => ({
        provider: "hardcover",
        externalId: String(i),
      })),
    });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("rejects a source with an unknown provider", () => {
    const book = baseBook({
      sources: [{ provider: "bookshop", externalId: "1" }],
    });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("returns a rejection rather than throwing for an injection-shaped provider value, so the route never hits a Postgres enum error", () => {
    const book = baseBook({
      sources: [{ provider: "'; DROP TABLE books; --", externalId: "1" }],
    });
    expect(() => catalogInput.validateTrackBook(book)).not.toThrow();
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("rejects a source with a non-string externalId", () => {
    const book = baseBook({ sources: [{ provider: "hardcover", externalId: 12345 }] });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("rejects a source with an externalId longer than the maximum", () => {
    const book = baseBook({
      sources: [
        { provider: "hardcover", externalId: "x".repeat(catalogInput.MAX_EXTERNAL_ID_LENGTH + 1) },
      ],
    });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("accepts an empty sources array", () => {
    expect(catalogInput.validateTrackBook(baseBook({ sources: [] })).ok).toBe(true);
  });

  it("rejects an http coverUrl, since only https is ever rendered", () => {
    const book = baseBook({ coverUrl: "http://example.com/cover.jpg" });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("rejects a coverUrl pointed at a private host", () => {
    const book = baseBook({ coverUrl: "https://localhost/cover.jpg" });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("accepts a safe https coverUrl", () => {
    const book = baseBook({ coverUrl: "https://covers.example.com/cover.jpg" });
    expect(catalogInput.validateTrackBook(book).ok).toBe(true);
  });

  it("rejects a description longer than the maximum", () => {
    const book = baseBook({ description: "x".repeat(catalogInput.MAX_TEXT_FIELD_LENGTH + 1) });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("accepts a description at exactly the maximum length", () => {
    const book = baseBook({ description: "x".repeat(catalogInput.MAX_TEXT_FIELD_LENGTH) });
    expect(catalogInput.validateTrackBook(book).ok).toBe(true);
  });

  it("rejects a seriesName longer than the maximum", () => {
    const book = baseBook({ seriesName: "x".repeat(catalogInput.MAX_SERIES_NAME_LENGTH + 1) });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("rejects an unknown datePrecision value", () => {
    const book = baseBook({ datePrecision: "decade" });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("accepts a known datePrecision value", () => {
    const book = baseBook({ datePrecision: "month" });
    expect(catalogInput.validateTrackBook(book).ok).toBe(true);
  });

  it("rejects a client-supplied null releaseDate", () => {
    const book = baseBook({ releaseDate: null });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("rejects a malformed releaseDate", () => {
    const book = baseBook({ releaseDate: "not-a-date" });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("accepts a well-formed releaseDate", () => {
    const book = baseBook({ releaseDate: "2027-01-15" });
    expect(catalogInput.validateTrackBook(book).ok).toBe(true);
  });

  it("rejects a confidence outside 0 to 100", () => {
    expect(catalogInput.validateTrackBook(baseBook({ confidence: -1 })).ok).toBe(false);
    expect(catalogInput.validateTrackBook(baseBook({ confidence: 101 })).ok).toBe(false);
  });

  it("rejects a non-finite confidence", () => {
    expect(catalogInput.validateTrackBook(baseBook({ confidence: Number.NaN })).ok).toBe(
      false,
    );
    expect(
      catalogInput.validateTrackBook(baseBook({ confidence: Number.POSITIVE_INFINITY })).ok,
    ).toBe(false);
  });

  it("accepts confidence at the boundaries", () => {
    expect(catalogInput.validateTrackBook(baseBook({ confidence: 0 })).ok).toBe(true);
    expect(catalogInput.validateTrackBook(baseBook({ confidence: 100 })).ok).toBe(true);
  });

  it("rejects a provenance entry naming an unknown provider", () => {
    const book = baseBook({ provenance: { title: "bookshop" } });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("accepts a provenance entry naming a known provider", () => {
    const book = baseBook({ provenance: { title: "hardcover" } });
    expect(catalogInput.validateTrackBook(book).ok).toBe(true);
  });

  it("does not echo the offending value back in the error message", () => {
    const secretLookingValue = "sk-super-secret-value-should-not-appear";
    const result = catalogInput.validateTrackBook(
      baseBook({ title: secretLookingValue.repeat(50) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(secretLookingValue);
    }
  });
});

describe("validateManualInput", () => {
  it("accepts a title-only submission", () => {
    const result = catalogInput.validateManualInput({ title: "An Unlisted Book" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.title).toBe("An Unlisted Book");
      expect(result.author).toBeUndefined();
    }
  });

  it("rejects a non-object body", () => {
    expect(catalogInput.validateManualInput("nope").ok).toBe(false);
    expect(catalogInput.validateManualInput(null).ok).toBe(false);
  });

  it("rejects a missing title", () => {
    expect(catalogInput.validateManualInput({}).ok).toBe(false);
  });

  it("rejects a non-string title without throwing", () => {
    expect(() => catalogInput.validateManualInput({ title: 12345 })).not.toThrow();
    expect(catalogInput.validateManualInput({ title: 12345 }).ok).toBe(false);
  });

  it("rejects a whitespace-only title", () => {
    expect(catalogInput.validateManualInput({ title: "   " }).ok).toBe(false);
  });

  it("rejects a title over the length bound", () => {
    const result = catalogInput.validateManualInput({
      title: "x".repeat(catalogInput.MAX_TITLE_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
  });

  it("trims the title", () => {
    const result = catalogInput.validateManualInput({ title: "  Trimmed  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.title).toBe("Trimmed");
  });

  it("rejects a non-string author", () => {
    expect(catalogInput.validateManualInput({ title: "T", author: 5 }).ok).toBe(false);
  });

  it("rejects an author over the length bound", () => {
    const result = catalogInput.validateManualInput({
      title: "T",
      author: "x".repeat(catalogInput.MAX_AUTHOR_NAME_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects notes over the length bound", () => {
    const result = catalogInput.validateManualInput({
      title: "T",
      notes: "x".repeat(catalogInput.MAX_TEXT_FIELD_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a sourceUrl over the length bound", () => {
    const result = catalogInput.validateManualInput({
      title: "T",
      sourceUrl: "https://example.com/" + "x".repeat(catalogInput.MAX_SOURCE_URL_LENGTH),
    });
    expect(result.ok).toBe(false);
  });

  it("carries author, notes, and sourceUrl through when valid", () => {
    const result = catalogInput.validateManualInput({
      title: "T",
      author: "  A. Author  ",
      notes: "  Some notes  ",
      sourceUrl: "  https://example.com/post  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.author).toBe("A. Author");
      expect(result.notes).toBe("Some notes");
      expect(result.sourceUrl).toBe("https://example.com/post");
    }
  });
});
