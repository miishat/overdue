-- Backs upsertSeries's onConflictDoNothing with a real constraint so
-- concurrent inserts of the same series title cannot both succeed.
--
-- Known v1 limitation: matching series on title alone means two genuinely
-- distinct series that happen to share a title will merge into one row.
-- Accepted for now; revisit if provider series ids become available.
ALTER TABLE "series" ADD CONSTRAINT "series_title_unique" UNIQUE("title");
