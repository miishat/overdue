-- Backs persistResolvedBook's onConflictDoUpdate with a real constraint so
-- re-persisting the same book, region, and format refreshes the existing
-- release row instead of appending a duplicate.
ALTER TABLE "releases" ADD CONSTRAINT "release_book_region_format_unique" UNIQUE("book_id","region","format");
