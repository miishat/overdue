import type {
  DatePrecision,
  ProviderName,
  ReleaseStatus,
} from "@/db/schema/enums";

/**
 * The comparable shape of one tracked book at one moment.
 *
 * releaseDate is a string rather than a Date on purpose. change_log stores
 * old_value and new_value as text, and src/lib/changes.ts parses them back
 * with new Date(value). Holding the stored representation here means the diff
 * writes exactly what the reader expects, with no formatting step in between
 * where a timezone could shift the day.
 */
export interface BookSnapshot {
  bookId: string;
  title: string;
  seriesId: string | null;
  seriesPosition: number | null;
  coverUrl: string | null;
  releaseDate: string | null;
  datePrecision: DatePrecision | null;
  status: ReleaseStatus;
  /** Provenance, not a watched value. Recorded on the change, not compared. */
  sourceProvider: ProviderName | null;
}

/**
 * The fields a change is reported for.
 *
 * bookId identifies rather than describes, and sourceProvider is provenance:
 * a field switching from one provider to another with the same value is not a
 * change the user should be told about.
 */
const WATCHED = [
  "title",
  "seriesId",
  "seriesPosition",
  "coverUrl",
  "releaseDate",
  "datePrecision",
  "status",
] as const;

export function snapshotFields(): readonly (keyof BookSnapshot)[] {
  return WATCHED;
}

export function snapshotEquals(a: BookSnapshot, b: BookSnapshot): boolean {
  return WATCHED.every((field) => a[field] === b[field]);
}
