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
  const isbnByTitleAuthor = new Map<string, string>();

  for (const book of books) {
    if (book.isbn13) {
      isbnByTitleAuthor.set(
        `ta:${normaliseTitle(book.title)}|${normaliseAuthor(book.authors[0])}`,
        `isbn:${book.isbn13}`,
      );
    }
  }

  for (const book of books) {
    const raw = identityKey(book);
    const key = raw.startsWith("ta:") ? (isbnByTitleAuthor.get(raw) ?? raw) : raw;
    const existing = byKey.get(key);
    if (existing) {
      existing.push(book);
    } else {
      byKey.set(key, [book]);
    }
  }

  return [...byKey.entries()].map(([key, records]) => ({ key, records }));
}
