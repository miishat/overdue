import { describe, expect, it } from "vitest";
import * as catalogInput from "./catalog-input";

// catalog-input.ts imports no database client (see the module comment at
// the top of catalog-input.ts): every guard here, including
// isValidClientReleaseDate, is a pure predicate. A static top-level import
// is enough; no DATABASE_URL placeholder or beforeAll dynamic-import dance
// is needed to dodge module evaluation order the way src/lib/tracks.test.ts
// once had to.

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

  // book.key never reaches the database (see persist.ts), but this module's
  // stated rule is bounded, not unbounded, for every string field, whether
  // or not it is ever persisted.
  it("rejects a key longer than the maximum", () => {
    const book = baseBook({ key: "x".repeat(catalogInput.MAX_KEY_LENGTH + 1) });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("accepts a key at exactly the maximum length", () => {
    const book = baseBook({ key: "x".repeat(catalogInput.MAX_KEY_LENGTH) });
    expect(catalogInput.validateTrackBook(book).ok).toBe(true);
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

  // sourceUrl is stored and, per src/lib/book-detail.ts, already selected
  // into the detail model. Nothing renders it as an <a href> yet, but a
  // javascript: value stored today is live ammunition for the first
  // component that does.
  it("rejects a javascript: sourceUrl on a book.sources entry", () => {
    const book = baseBook({
      sources: [
        {
          provider: "hardcover",
          externalId: "1",
          sourceUrl: "javascript:alert(document.cookie)",
        },
      ],
    });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("accepts an https sourceUrl on a non-default port, unlike isSafeCoverUrl", () => {
    const book = baseBook({
      sources: [
        {
          provider: "hardcover",
          externalId: "1",
          sourceUrl: "https://publisher.example.com:8443/book/1",
        },
      ],
    });
    expect(catalogInput.validateTrackBook(book).ok).toBe(true);
  });

  // The two routes used to bound this same conceptual field differently:
  // MAX_TEXT_FIELD_LENGTH (5000) here, MAX_SOURCE_URL_LENGTH (2000) on
  // /api/manual. Unified on the tighter bound.
  it("rejects a book.sources sourceUrl over MAX_SOURCE_URL_LENGTH", () => {
    const book = baseBook({
      sources: [
        {
          provider: "hardcover",
          externalId: "1",
          sourceUrl:
            "https://example.com/" + "x".repeat(catalogInput.MAX_SOURCE_URL_LENGTH),
        },
      ],
    });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
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

  // series_position is numeric(6, 2) in src/db/schema/catalog.ts: 6 total
  // digits, 2 after the decimal, so its magnitude tops out at 9999.99. A
  // seriesPosition past that bound used to pass this validator, reach
  // persist.ts's `.toString()`, and raise a Postgres "numeric field
  // overflow" with no try/catch in the route to turn it into a 400 (E1).
  describe("seriesPosition bound (E1)", () => {
    it("rejects a seriesPosition whose magnitude the numeric(6,2) column cannot store", () => {
      const book = baseBook({ seriesPosition: 12345 });
      expect(catalogInput.validateTrackBook(book).ok).toBe(false);
    });

    it("rejects a negative seriesPosition past the same magnitude bound", () => {
      const book = baseBook({ seriesPosition: -12345 });
      expect(catalogInput.validateTrackBook(book).ok).toBe(false);
    });

    it("accepts a seriesPosition just inside the column's magnitude bound", () => {
      const book = baseBook({ seriesPosition: 9999.99 });
      expect(catalogInput.validateTrackBook(book).ok).toBe(true);
    });
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

  // releases.date is a Postgres `date` column with no partial form; "2027"
  // and "2027-01" are not valid `date` literals and used to reach it
  // unrejected, raising the same class of 500 (E1) as the seriesPosition
  // overflow above.
  it("rejects a year-only releaseDate, a shape Postgres's date column rejects", () => {
    const book = baseBook({ releaseDate: "2027" });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
  });

  it("rejects a year-month releaseDate, a shape Postgres's date column rejects", () => {
    const book = baseBook({ releaseDate: "2027-01" });
    expect(catalogInput.validateTrackBook(book).ok).toBe(false);
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

  it("rejects a javascript: sourceUrl", () => {
    const result = catalogInput.validateManualInput({
      title: "T",
      sourceUrl: "javascript:alert(1)",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts an https sourceUrl on a non-default port", () => {
    const result = catalogInput.validateManualInput({
      title: "T",
      sourceUrl: "https://publisher.example.com:8443/post",
    });
    expect(result.ok).toBe(true);
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

// Moved here from src/lib/tracks.test.ts: isValidClientReleaseDate now lives
// in catalog-input.ts, alongside this module's other pure guards, rather
// than in tracks.ts, which imports the database client. See the module
// comment at the top of this file.
describe("isValidClientReleaseDate", () => {
  it("accepts an omitted releaseDate", () => {
    expect(catalogInput.isValidClientReleaseDate(undefined)).toBe(true);
  });

  it("accepts a full day-precision date string", () => {
    expect(catalogInput.isValidClientReleaseDate("2027-01-15")).toBe(true);
  });

  // CHOSEN (item 2): reject a partial date rather than normalise it. See the
  // reasoning on isValidClientReleaseDate's own comment in catalog-input.ts.
  it("rejects a month-precision date string; releases.date has no partial form", () => {
    expect(catalogInput.isValidClientReleaseDate("2027-01")).toBe(false);
  });

  it("rejects a year-only date string; releases.date has no partial form", () => {
    expect(catalogInput.isValidClientReleaseDate("2027")).toBe(false);
  });

  it("rejects a client-supplied null, refusing the withdrawal channel entirely", () => {
    expect(catalogInput.isValidClientReleaseDate(null)).toBe(false);
  });

  it("rejects a non-string, non-null value without throwing", () => {
    expect(catalogInput.isValidClientReleaseDate(12345)).toBe(false);
    expect(catalogInput.isValidClientReleaseDate({})).toBe(false);
    expect(catalogInput.isValidClientReleaseDate(["2027-01-01"])).toBe(false);
  });

  it("rejects a malformed date string", () => {
    expect(catalogInput.isValidClientReleaseDate("not-a-date")).toBe(false);
    expect(catalogInput.isValidClientReleaseDate("")).toBe(false);
  });
});
