import type { ResolvedBook } from "@/resolution/resolve";

interface Props {
  book: ResolvedBook;
  onSelect: (book: ResolvedBook) => void;
}

export function SearchResult({ book, onSelect }: Props) {
  const badge =
    book.seriesName && book.seriesPosition
      ? `Book ${book.seriesPosition} of ${book.seriesName}`
      : book.seriesName;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(book)}
        className="flex w-full items-center gap-3 border-b px-2 py-2 text-left focus-visible:outline focus-visible:outline-2"
      >
        {book.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={book.coverUrl}
            alt=""
            className="aspect-[2/3] w-10 rounded-[1px] object-cover shadow-sm"
          />
        ) : (
          <span
            aria-hidden="true"
            className="aspect-[2/3] w-10 rounded-[1px] border border-dashed opacity-40"
          />
        )}

        <span className="min-w-0 flex-1">
          <span className="block truncate font-[family-name:var(--font-newsreader)] text-base">
            {book.title}
          </span>
          <span className="block truncate text-xs opacity-70">
            {book.authors.join(", ") || "Unknown author"}
          </span>
          {badge ? (
            <span className="mt-1 block font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-widest opacity-80">
              {badge}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}
