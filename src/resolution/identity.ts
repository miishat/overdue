import type { ProviderBook } from "@/providers/types";

export interface IdentityGroup {
  key: string;
  records: ProviderBook[];
}

export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/^(the|a|an)\s+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseAuthor(author: string | undefined): string {
  if (!author) return "";
  return author.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function identityKey(book: ProviderBook): string {
  if (book.isbn13) return `isbn:${book.isbn13}`;
  return `ta:${normaliseTitle(book.title)}|${normaliseAuthor(book.authors[0])}`;
}

export function groupByIdentity(books: ProviderBook[]): IdentityGroup[] {
  const byKey = new Map<string, ProviderBook[]>();
  const isbnByTitleAuthor = new Map<string, Set<string>>();

  for (const book of books) {
    if (book.isbn13) {
      const taKey = `ta:${normaliseTitle(book.title)}|${normaliseAuthor(book.authors[0])}`;
      const isbnKey = `isbn:${book.isbn13}`;
      const existing = isbnByTitleAuthor.get(taKey);
      if (existing) {
        existing.add(isbnKey);
      } else {
        isbnByTitleAuthor.set(taKey, new Set([isbnKey]));
      }
    }
  }

  for (const book of books) {
    const raw = identityKey(book);
    let key = raw;
    if (raw.startsWith("ta:")) {
      const candidates = isbnByTitleAuthor.get(raw);
      // If exactly one ISBN is seen under this title-author key, an ISBN-less
      // record can safely join it. If more than one distinct ISBN shares the
      // same title and author, we genuinely do not know which book the
      // ISBN-less record belongs to, so we deliberately do not guess and
      // leave it grouped under its own title-author key instead. Task 13's
      // trust matrix and confidence scoring are designed to cope with that
      // visible ambiguity rather than a silent wrong answer.
      if (candidates && candidates.size === 1) {
        key = [...candidates][0];
      }
    }
    const existing = byKey.get(key);
    if (existing) {
      existing.push(book);
    } else {
      byKey.set(key, [book]);
    }
  }

  return [...byKey.entries()].map(([key, records]) => ({ key, records }));
}
